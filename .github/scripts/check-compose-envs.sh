#!/usr/bin/env sh
# Fails when compose.yaml misses a supported environment variable or lists one that envs.sh refuses.
# Supported: NPMPRO_RUNTIME_ENVS and NPMPRO_STARTUP_ENVS in envs.sh, the OIDC_*, TRAFFIC_* and GEOIP_* names the
# backend reads, and COOKIE_SECRET. Refused: the names envs.sh stops on with "not supported" or "replaced by".
set -u

ENVS="rootfs/usr/local/bin/envs.sh"
COMPOSE="compose.yaml"

list_of() {
    sed -n "s/^$1=\"\(.*\)\"$/\1/p" "$ENVS"
}

supported="$(list_of NPMPRO_RUNTIME_ENVS) $(list_of NPMPRO_STARTUP_ENVS)"
supported="$supported $(grep -ohE '"(OIDC|TRAFFIC|GEOIP)_[A-Z0-9_]+"' backend/lib/oidc-rules.js backend/lib/monitoring-rules.js | tr -d '"' | sort -u | tr '\n' ' ')"
supported="$supported COOKIE_SECRET"

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

if [ -z "$(printf '%s' "$supported" | tr -d ' ')" ] || [ -z "$(printf '%s' "$refused" | tr -d ' ')" ]; then
    echo "Could not read the variable lists from $ENVS"
    exit 1
fi

failed=0
for name in $supported; do
    if ! grep -q "\"$name=" "$COMPOSE"; then
        echo "$COMPOSE does not list the supported variable $name"
        failed=1
    fi
done
for name in $refused; do
    if grep -qw "$name" "$COMPOSE"; then
        echo "$COMPOSE lists $name, which envs.sh refuses"
        failed=1
    fi
done

if [ "$failed" -ne 0 ]; then
    exit 1
fi
echo "compose.yaml lists every supported variable and no removed one"
