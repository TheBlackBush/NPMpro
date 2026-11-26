#!/usr/bin/env sh
# Fails when the npmpro service in compose.yaml misses a supported environment variable or lists one that envs.sh
# refuses. Supported: NPMPRO_RUNTIME_ENVS and NPMPRO_STARTUP_ENVS in envs.sh, the OIDC_*, TRAFFIC_*, GEOIP_* and SMTP_* names,
# PUBLIC_URL and MAIL_LANGUAGE the backend reads, and COOKIE_SECRET. Refused: the names envs.sh stops on with "not supported" or "replaced by".
# Every NPMPRO_SECRET_ENVS name the service lists also needs its commented NAME_FILE=/run/secrets/ line, and a
# NAME_FILE line must belong to one of them.
# POSIX sh, sed, awk and grep -E -q only.
set -u

ENVS="rootfs/usr/local/bin/envs.sh"
COMPOSE="compose.yaml"

list_of() {
    sed -n "s/^$1=\"\(.*\)\"$/\1/p" "$ENVS"
}

runtime="$(list_of NPMPRO_RUNTIME_ENVS)"
startup="$(list_of NPMPRO_STARTUP_ENVS)"
if [ -z "$runtime" ] || [ -z "$startup" ]; then
    echo "Could not read NPMPRO_RUNTIME_ENVS or NPMPRO_STARTUP_ENVS from $ENVS"
    exit 1
fi
secret="$(list_of NPMPRO_SECRET_ENVS)"
if [ -z "$secret" ]; then
    echo "Could not read NPMPRO_SECRET_ENVS from $ENVS"
    exit 1
fi

# every quoted OIDC_*, TRAFFIC_*, GEOIP_* and SMTP_* name, PUBLIC_URL and MAIL_LANGUAGE in the backend rule files
backend="$(awk '{
    line = $0
    while (match(line, /"((OIDC|TRAFFIC|GEOIP|SMTP)_[A-Z0-9_]+|PUBLIC_URL|MAIL_LANGUAGE)"/)) {
        print substr(line, RSTART + 1, RLENGTH - 2)
        line = substr(line, RSTART + RLENGTH)
    }
}' backend/lib/oidc-rules.js backend/lib/monitoring-rules.js backend/lib/mail/settings-rules.js | sort -u)"
if [ -z "$backend" ]; then
    echo "Could not read the OIDC, TRAFFIC, GEOIP, SMTP, PUBLIC_URL and MAIL_LANGUAGE names from backend/lib"
    exit 1
fi

supported="$runtime $startup $backend COOKIE_SECRET"

# the variables of an "if [ -n "$NAME" ] ..." line whose next line refuses them
refused="$(awk '
    /^if .*-n "\$[A-Z0-9_]+"/ {
        names = ""
        line = $0
        while (match(line, /-n "\$[A-Z0-9_]+"/)) {
            names = names " " substr(line, RSTART + 5, RLENGTH - 6)
            line = substr(line, RSTART + RLENGTH)
        }
        next_is_check = 1
        next
    }
    next_is_check {
        if ($0 ~ /not supported|replaced by ACME_SERVER/) print names
        next_is_check = 0
    }
' "$ENVS")"
if [ -z "$(printf '%s' "$refused" | tr -d ' \n')" ]; then
    echo "Could not read the refused variables from $ENVS"
    exit 1
fi

# the npmpro service: from its key up to the next service key (the other services are commented out)
service="$(awk '
    /^  npmpro:[[:space:]]*$/ { inside = 1; print; next }
    inside && /^#?  [A-Za-z0-9_-]+:[[:space:]]*$/ { exit }
    inside { print }
' "$COMPOSE")"
if [ -z "$service" ]; then
    echo "Could not find the npmpro service in $COMPOSE"
    exit 1
fi

failed=0
for name in $supported; do
    if ! printf '%s\n' "$service" | grep -E -q "\"$name="; then
        echo "The npmpro service in $COMPOSE does not list the supported variable $name"
        failed=1
    fi
done
for name in $refused; do
    if printf '%s\n' "$service" | grep -E -q "(^|[^A-Za-z0-9_])$name([^A-Za-z0-9_]|\$)"; then
        echo "The npmpro service in $COMPOSE lists $name, which envs.sh refuses"
        failed=1
    fi
done
# a secret listed as NAME also has its NAME_FILE line (CROWDSEC_API_KEY is not in compose.yaml, so it needs none)
for name in $secret; do
    if printf '%s\n' "$service" | grep -E -q "\"$name=" && ! printf '%s\n' "$service" | grep -E -q "\"${name}_FILE=/run/secrets/"; then
        echo "The npmpro service in $COMPOSE lists $name but not ${name}_FILE"
        failed=1
    fi
done
for name in $(printf '%s\n' "$service" | sed -n 's/.*"\([A-Z0-9_]*\)_FILE=.*/\1/p'); do
    case " $secret " in
        *" $name "*) ;;
        *)
            echo "The npmpro service in $COMPOSE lists ${name}_FILE, but $name cannot be read from a file (NPMPRO_SECRET_ENVS in $ENVS)"
            failed=1
            ;;
    esac
done

if [ "$failed" -ne 0 ]; then
    exit 1
fi
echo "The npmpro service in compose.yaml lists every supported variable, the NAME_FILE line of each secret and no removed one"
