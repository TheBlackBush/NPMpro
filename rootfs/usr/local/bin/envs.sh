#!/usr/bin/env sh
# A fatal setting prints the reason and sleeps (sleep inf) instead of exiting:
# a restart loop would repeat ACME requests and flood the log.

umask 022

cat << 'EOF'

-------------------------------------
 _   _ ____  __  __
| \ | |  _ \|  \/  |_ __  _ __ ___
|  \| | |_) | |\/| | '_ \| '__/ _ \
| |\  |  __/| |  | | |_) | | | (_) |
|_| \_|_|   |_|  |_| .__/|_|  \___/
                   |_|
-------------------------------------
EOF
echo "Version:  $(jq -r .version /app/package.json)
Date:     $(date)
-------------------------------------
"


if [ "$(whoami)" != "root" ] || [ "$(id -u)" != "0" ] || [ "$(id -g)" != "0" ] || [ -n "$UID" ] || [ -n "$GID" ]; then
    echo "-----------------------------------------------------------------------------------------------"
    echo "This docker container must be run as root, do not specify a user. Please use PUID/PGID instead."
    echo "-----------------------------------------------------------------------------------------------"
    sleep inf
fi

if [ ! -d /data ]; then
    echo "----------------------------------------------"
    echo "/data is not mounted! Check your compose.yaml."
    echo "----------------------------------------------"
    sleep inf
fi


# /data/.env is sourced as root, so it must be a file only root can change. /data belongs to the PUID user when PUID
# is set, and that user could otherwise put commands into it (or remove a PUID line from it). A missing or empty file
# is (re)created as root. No PUID process runs yet, so nothing can swap the file between these checks and the source.
if [ -L /data/.env ] || { [ -e /data/.env ] && [ ! -f /data/.env ]; }; then
    echo "/data/.env must be a regular file, not a link or a folder. Replace it and recreate the container."
    sleep inf
fi
if [ ! -s /data/.env ]; then
    rm -f /data/.env
    (umask 077 && : > /data/.env)
fi
if [ "$(stat -c %u /data/.env)" != "0" ] || [ "$(stat -c %h /data/.env)" != "1" ] || [ -n "$(find /data/.env -perm /022)" ]; then
    echo "-----------------------------------------------------------------------------------------------------------"
    echo "/data/.env must be owned by root, have one link and not be writable by group or others: it is read as root."
    echo "Run this once on the host (with the path of your data folder), then recreate the container:"
    echo "  chown root:root /path/to/data/.env && chmod 600 /path/to/data/.env"
    echo "Or move the variables to environment: or env_file: in compose.yaml and delete /data/.env."
    echo "-----------------------------------------------------------------------------------------------------------"
    sleep inf
fi
chmod 600 /data/.env
set -a
# shellcheck source=/dev/null
. /data/.env
set +a
mkdir -p /etc/npmpro
chown 0:0 /etc/npmpro
chmod 755 /etc/npmpro
if [ -s /etc/npmpro/env.sha512sum ] && [ "$(cat /etc/npmpro/env.sha512sum)" != "$(sha512sum < /data/.env)" ]; then
    echo "You need to recreate the NPMpro container after changing the .env file, restarting the container after changing the .env file is not supported"
    sleep inf
fi
env_sum="$(mktemp /etc/npmpro/.env-sum.XXXXXX)"
sha512sum < /data/.env > "$env_sum"
mv -f "$env_sum" /etc/npmpro/env.sha512sum

# The secret variables that can also be given as a file (Docker and Compose secrets): NAME_FILE=/run/secrets/<name>
# sets NAME to the content of that file and is unset. Read here, once and as root, after /data/.env (which may set
# NAME_FILE too) and before NPMPRO_USER_ENV and the checks below, so a value from a file counts as set by the user and
# goes through the same checks. Nothing before this line reads these names. See secret-files.sh; the list is checked by
# test/secret-files.test.js and .github/scripts/check-compose-envs.sh.
NPMPRO_SECRET_ENVS="DB_MYSQL_USER DB_MYSQL_PASSWORD DB_POSTGRES_USER DB_POSTGRES_PASSWORD INITIAL_ADMIN_EMAIL INITIAL_ADMIN_PASSWORD ACME_EMAIL ACME_EAB_KID ACME_EAB_HMAC_KEY COOKIE_SECRET OIDC_CLIENT_ID OIDC_CLIENT_SECRET GEOIP_ACCOUNT_ID GEOIP_LICENSE_KEY CROWDSEC_API_KEY SMTP_USERNAME SMTP_PASSWORD"
# shellcheck source=/dev/null
. /usr/local/bin/secret-files.sh
if ! secret_files_read /data "$NPMPRO_SECRET_ENVS"; then
    sleep inf
fi

# Env vars that are settings in the UI (backend/lib/runtime-rules.js) and the ones listed on the Environment page
# (backend/lib/environment-info.js), checked by test/environment-info.test.js.
# NPMPRO_USER_ENV lists those set (non-empty) before the defaults below: the backend treats only these as set by the
# user and applies the stored settings to the others. NPMPRO_USER_RUNTIME_ENV is its runtime part, for ENV_SHA512SUM.
# The NGINX_* names in NPMPRO_RUNTIME_ENVS are settings too: the backend owns them and a set env var locks the field.
NPMPRO_RUNTIME_ENVS="ACME_KEY_TYPE ACME_KEY_SIZE ACME_PROFILE ACME_MUST_STAPLE ACME_SERVER_TLS_VERIFY CERTBOT_RUN_INTERVAL CERT_WARNING_DAYS ACME_OCSP_STAPLING CUSTOM_OCSP_STAPLING DEFAULT_CERT_ID ECH_ROTATION_INTERVAL TRUST_IP TRUST_CLOUDFLARE AUTH_REQUEST_ANUBIS_UPSTREAM AUTH_REQUEST_TINYAUTH_UPSTREAM AUTH_REQUEST_OAUTH2PROXY_UPSTREAM AUTH_REQUEST_VOIDAUTH_UPSTREAM AUTH_REQUEST_AUTHELIA_UPSTREAM AUTH_REQUEST_AUTHENTIK_UPSTREAM AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES LOGROTATE LOGROTATIONS NGINX_LOG_FORMAT NGINX_TLS_HANDSHAKE_LOG DISABLE_NGINX_BEAUTIFIER DISABLE_GRAVATAR NGINX_LOG_NOT_FOUND NGINX_WORKER_PROCESSES NGINX_WORKER_CONNECTIONS NGINX_WORKER_SHUTDOWN_TIMEOUT NGINX_CPU_AFFINITY NGINX_RESOLVER NGINX_RESOLVER_HOSTS NGINX_RESOLVER_IPV6 NGINX_RESOLVER_VALID NGINX_FORCE_X25519MLKEM768 NGINX_DISABLE_TLS12 NGINX_TRUST_SECPR1 NGINX_TRUST_RSA_PKCS1 NGINX_LOAD_NJS_MODULE NGINX_LOAD_LDAP_MODULE NGINX_LOAD_NTLM_MODULE NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE DDNS_PERIOD DDNS_COOLDOWN DDNS_IPV4_SERVICES DDNS_IPV6_SERVICES DDNS_RESOLVER"
NPMPRO_STARTUP_ENVS="NPM_PORT HTTP_PORT HTTPS_PORT IPV4_BINDING IPV6_BINDING NPM_IPV4_BINDING NPM_IPV6_BINDING NPM_LISTEN_LOCALHOST DISABLE_IPV6 DISABLE_HTTP DISABLE_H3_QUIC LISTEN_PROXY_PROTOCOL LISTEN_PROXY_PROTOCOL_HTTP LISTEN_PROXY_PROTOCOL_HTTPS ENABLE_MPTCP NGINX_QUIC_BPF PUID PGID TZ PHP83 PHP84 PHP85 PHP83_APKS PHP84_APKS PHP85_APKS PHP_APKS GOA GOACLA DB_MYSQL_HOST DB_MYSQL_PORT DB_MYSQL_NAME DB_MYSQL_USER DB_MYSQL_PASSWORD DB_POSTGRES_HOST DB_POSTGRES_PORT DB_POSTGRES_NAME DB_POSTGRES_USER DB_POSTGRES_PASSWORD INITIAL_ADMIN_EMAIL INITIAL_ADMIN_PASSWORD INITIAL_DEFAULT_PAGE ACME_SERVER ACME_EMAIL ACME_EAB_KID ACME_EAB_HMAC_KEY NODE_TLS_REJECT_UNAUTHORIZED NC_AIO NC_DOMAIN ENABLE_PRERUN"
NPMPRO_USER_ENV=""
NPMPRO_USER_RUNTIME_ENV=""
for name in $NPMPRO_RUNTIME_ENVS $NPMPRO_STARTUP_ENVS; do
    if [ -n "$(printenv "$name")" ]; then
        NPMPRO_USER_ENV="${NPMPRO_USER_ENV:+$NPMPRO_USER_ENV }$name"
        case " $NPMPRO_RUNTIME_ENVS " in
            *" $name "*) NPMPRO_USER_RUNTIME_ENV="${NPMPRO_USER_RUNTIME_ENV:+$NPMPRO_USER_RUNTIME_ENV }$name" ;;
        esac
    fi
done
export NPMPRO_USER_ENV

# TZ, GOA and the GoAccess options saved in the UI, where the env does not set them; after NPMPRO_USER_ENV so they do
# not count as set by the user. The file is parsed line by line, never sourced.
# shellcheck source=/dev/null
. /usr/local/bin/startup-settings.sh
startup_settings_warn /data/npmpro/startup-settings.env
if [ -z "$TZ" ]; then
    TZ="$(startup_setting /data/npmpro/startup-settings.env TZ)"
    export TZ="${TZ:-UTC}"
fi
if [ -z "$GOA" ]; then
    GOA="$(startup_setting /data/npmpro/startup-settings.env GOA)"
fi
# the GoAccess options from the UI become fixed GOACLA flags; a GOACLA from the env wins
if [ -z "$GOACLA" ]; then
    GOACLA="$(startup_settings_goacla /data/npmpro/startup-settings.env)"
fi
# the instance CA saved in Settings, Certificates, where the env does not set ACME_SERVER; after NPMPRO_USER_ENV so it
# does not count as set by the user. A line startup-settings.sh does not accept is reported above and Let's Encrypt
# applies.
acme_server_stored=false
if [ -z "$ACME_SERVER" ]; then
    ACME_SERVER="$(startup_setting /data/npmpro/startup-settings.env ACME_SERVER)"
    [ -n "$ACME_SERVER" ] && acme_server_stored=true
fi


if [ -n "$NC_AIO" ] && ! echo "$NC_AIO" | grep -q "^true$\|^false$"; then
    echo "NC_AIO needs to be true or false."
    sleep inf
fi
if [ "$NC_AIO" = "true" ]; then
    if [ -z "$NC_DOMAIN" ] || ! echo "$NC_DOMAIN" | grep -q "\."; then
        echo "NC_DOMAIN is unset (but required in AIO mode) or invalid, it needs to contain a dot."
        sleep inf
    fi
    export DISABLE_HTTP="${DISABLE_HTTP:-true}"
fi


export ACME_SERVER="${ACME_SERVER:-https://acme-v02.api.letsencrypt.org/directory}"

# the start log shows which CA is used, where the value came from and whether certbot has an account for it
# shellcheck source=/dev/null
. /usr/local/bin/acme-status.sh
acme_source="default"
case " $NPMPRO_USER_ENV " in
    *\ ACME_SERVER\ *) acme_source="env" ;;
    *)
        [ "$acme_server_stored" = true ] && acme_source="settings"
        ;;
esac
acme_email_set=false
[ -n "$ACME_EMAIL" ] && acme_email_set=true
acme_eab_set=false
[ -n "$ACME_EAB_KID" ] && [ -n "$ACME_EAB_HMAC_KEY" ] && acme_eab_set=true
acme_status "$ACME_SERVER" "$acme_source" /data/tls/certbot/accounts "$acme_email_set" "$acme_eab_set"

case "$ACME_SERVER" in
    "https://acme-v02.api.letsencrypt.org/directory")
        export ACME_PROFILE="${ACME_PROFILE:-shortlived}"
        ;;

    "https://dv.acme-v02.api.pki.goog/directory")
        export ACME_OCSP_STAPLING="${ACME_OCSP_STAPLING:-true}"
        export ACME_MUST_STAPLE="${ACME_MUST_STAPLE:-true}"
        ;;

    "https://acme.zerossl.com/v2/DV90")
        export ACME_OCSP_STAPLING="${ACME_OCSP_STAPLING:-true}"
        export ACME_MUST_STAPLE="${ACME_MUST_STAPLE:-true}"
        ;;
esac

export ACME_MUST_STAPLE="${ACME_MUST_STAPLE:-false}"
export ACME_OCSP_STAPLING="${ACME_OCSP_STAPLING:-false}"
export ACME_PROFILE="${ACME_PROFILE:-none}"

export ACME_KEY_TYPE="${ACME_KEY_TYPE:-ecdsa}"
case "$ACME_KEY_TYPE" in
    ecdsa)
        export ACME_KEY_SIZE="${ACME_KEY_SIZE:-secp384r1}"
        ;;
    rsa)
        export ACME_KEY_SIZE="${ACME_KEY_SIZE:-4096}"
        ;;
esac

export ACME_SERVER_TLS_VERIFY="${ACME_SERVER_TLS_VERIFY:-true}"

export CUSTOM_OCSP_STAPLING="${CUSTOM_OCSP_STAPLING:-false}"

export PUID="${PUID:-0}"
export PGID="${PGID:-0}"
export NPM_PORT="${NPM_PORT:-81}"
export IPV4_BINDING="${IPV4_BINDING:-0.0.0.0}"
export NPM_IPV4_BINDING="${NPM_IPV4_BINDING:-0.0.0.0}"
export IPV6_BINDING="${IPV6_BINDING:-[::]}"
export NPM_IPV6_BINDING="${NPM_IPV6_BINDING:-[::]}"
export DISABLE_IPV6="${DISABLE_IPV6:-false}"
export NPM_LISTEN_LOCALHOST="${NPM_LISTEN_LOCALHOST:-false}"
export DEFAULT_CERT_ID="${DEFAULT_CERT_ID:-0}"
export HTTP_PORT="${HTTP_PORT:-80}"
export HTTPS_PORT="${HTTPS_PORT:-443}"
export DISABLE_HTTP="${DISABLE_HTTP:-false}"
export LISTEN_PROXY_PROTOCOL="${LISTEN_PROXY_PROTOCOL:-false}"
export LISTEN_PROXY_PROTOCOL_HTTP="${LISTEN_PROXY_PROTOCOL_HTTP:-false}"
export LISTEN_PROXY_PROTOCOL_HTTPS="${LISTEN_PROXY_PROTOCOL_HTTPS:-false}"
export DISABLE_H3_QUIC="${DISABLE_H3_QUIC:-false}"
export ENABLE_MPTCP="${ENABLE_MPTCP:-false}"
export NGINX_QUIC_BPF="${NGINX_QUIC_BPF:-false}"
export NGINX_LOG_NOT_FOUND="${NGINX_LOG_NOT_FOUND:-false}"
# default: one worker per CPU thread the container may use (nproc follows CPU pinning), at most 4; auto or a number
# overrides it
if [ -z "$NGINX_WORKER_PROCESSES" ]; then
    NGINX_WORKER_PROCESSES="$(nproc)"
    [ "$NGINX_WORKER_PROCESSES" -gt 4 ] && NGINX_WORKER_PROCESSES=4
fi
export NGINX_WORKER_PROCESSES
export NGINX_WORKER_CONNECTIONS="${NGINX_WORKER_CONNECTIONS:-512}"
export NGINX_WORKER_SHUTDOWN_TIMEOUT="${NGINX_WORKER_SHUTDOWN_TIMEOUT:-1h}"
export NGINX_CPU_AFFINITY="${NGINX_CPU_AFFINITY:-off}"
export NGINX_RESOLVER="${NGINX_RESOLVER:-}"
export NGINX_RESOLVER_HOSTS="${NGINX_RESOLVER_HOSTS:-true}"
export NGINX_RESOLVER_IPV6="${NGINX_RESOLVER_IPV6:-true}"
export NGINX_RESOLVER_VALID="${NGINX_RESOLVER_VALID:-}"
export NGINX_FORCE_X25519MLKEM768="${NGINX_FORCE_X25519MLKEM768:-false}"
export NGINX_DISABLE_TLS12="${NGINX_DISABLE_TLS12:-false}"
export NGINX_TRUST_SECPR1="${NGINX_TRUST_SECPR1:-true}"
export NGINX_TRUST_RSA_PKCS1="${NGINX_TRUST_RSA_PKCS1:-false}"
export DISABLE_NGINX_BEAUTIFIER="${DISABLE_NGINX_BEAUTIFIER:-false}"
export TRUST_CLOUDFLARE="${TRUST_CLOUDFLARE:-false}"
export LOGROTATE="${LOGROTATE:-false}"
export LOGROTATIONS="${LOGROTATIONS:-3}"
export CERTBOT_RUN_INTERVAL="${CERTBOT_RUN_INTERVAL:-3}"
export CERT_WARNING_DAYS="${CERT_WARNING_DAYS:-14}"
export ECH_ROTATION_INTERVAL="${ECH_ROTATION_INTERVAL:-1}"
export GOA="${GOA:-false}"
export GOACLA="${GOACLA:-"--agent-list --real-os --double-decode --anonymize-ip --anonymize-level=1 --keep-last=30 --with-output-resolver --no-query-string"}"
export PHP83="${PHP83:-false}"
export PHP84="${PHP84:-false}"
export PHP85="${PHP85:-false}"
export DISABLE_GRAVATAR="${DISABLE_GRAVATAR:-false}"
export NGINX_LOAD_NJS_MODULE="${NGINX_LOAD_NJS_MODULE:-false}"
export NGINX_LOAD_LDAP_MODULE="${NGINX_LOAD_LDAP_MODULE:-false}"
export NGINX_LOAD_NTLM_MODULE="${NGINX_LOAD_NTLM_MODULE:-false}"
export NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE="${NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE:-false}"
# the first start after an upgrade checks the old folder /data/anubis (moved to /data/public/anubis by data-setup.sh)
anubis_dir=/data/public/anubis
[ -d /data/anubis ] && anubis_dir=/data/anubis
if [ -s "$anubis_dir"/happy.webp ] && [ -s "$anubis_dir"/reject.webp ] && [ -s "$anubis_dir"/pensive.webp ]; then
    export AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES="${AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES:-true}"
else
    export AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES="${AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES:-false}"
fi


#tmp
if [ -n "$NPM_DISABLE_IPV6" ]; then
    echo "NPM_DISABLE_IPV6 env is not supported. DISABLE_IPV6 now also disables IPv6 for the NPMpro web UI."
    sleep inf
fi
#tmp
if [ -n "$GOA_DISABLE_IPV6" ] || [ -n "$GOA_PORT" ] || [ -n "$GOA_IPV4_BINDING" ] || [ -n "$GOA_IPV6_BINDING" ] || [ -n "$GOA_LISTEN_LOCALHOST" ]; then
    echo "GOA_DISABLE_IPV6, GOA_PORT, GOA_IPV4_BINDING, GOA_IPV6_BINDING and GOA_LISTEN_LOCALHOST envs are not supported. goaccess is now served under /goaccess of the NPMpro web UI."
    sleep inf
fi
#tmp
if [ -n "$NIBEP" ]; then
    echo "NIBEP env is not supported. NPMpro now uses a unix socket instead."
    sleep inf
fi
#tmp
if [ -n "$GOAIWSP" ]; then
    echo "GOAIWSP env is not supported. NPMpro now uses a unix socket instead."
    sleep inf
fi

#tmp
if [ -n "$IPRT" ]; then
    echo "IPRT env is not supported. NPMpro now only updates and reloads if needed."
    sleep inf
fi

#tmp
if [ -n "$NGINX_HSTS_SUBDMAINS" ]; then
    echo "NGINX_HSTS_SUBDMAINS env is not supported. It was moved back to the WebUI."
    sleep inf
fi

#tmp
if [ -n "$NGINX_HSTS_SUBDOMAINS" ]; then
    echo "NGINX_HSTS_SUBDOMAINS env is not supported. It was moved back to the WebUI."
    sleep inf
fi

#tmp
if [ -n "$HTTP3_ALT_SVC_PORT" ]; then
    echo "HTTP3_ALT_SVC_PORT env is not supported. \$request_port (if empty 443) is now used instead."
    sleep inf
fi

#tmp
if [ -n "$NGINX_LOAD_FANCYINDEX_MODULE" ]; then
    echo "NGINX_LOAD_FANCYINDEX_MODULE env is not supported. The module is always loaded."
    sleep inf
fi

#tmp
if [ -n "$NGINX_LOAD_OPENTELEMETRY_MODULE" ]; then
    echo "NGINX_LOAD_OPENTELEMETRY_MODULE env is not supported. The module was removed."
    sleep inf
fi

#tmp
if [ -n "$NGINX_LOAD_GEOIP_MODULE" ]; then
    echo "NGINX_LOAD_GEOIP_MODULE env is not supported. The module was removed."
    sleep inf
fi

#tmp
if [ -n "$NGINX_LOAD_GEOIP2_MODULE" ]; then
    echo "NGINX_LOAD_GEOIP2_MODULE env is not supported. The geoip2 module was replaced by the geoip module, which is always loaded, see https://github.com/TheBlackBush/NPMpro/wiki/Security#geoblocking for the new config."
    sleep inf
fi

#tmp
if [ -n "$NGINX_LOAD_OPENAPPSEC_ATTACHMENT_MODULE" ]; then
    echo "NGINX_LOAD_OPENAPPSEC_ATTACHMENT_MODULE env is not supported. The module was removed."
    sleep inf
fi

#tmp
if [ -n "$FULLCLEAN" ]; then
    echo "FULLCLEAN env is not supported anymore."
    sleep inf
fi

#tmp
if [ -n "$NGINX_DISABLE_PROXY_BUFFERING" ]; then
    echo "NGINX_DISABLE_PROXY_BUFFERING env is not supported anymore."
    sleep inf
fi

#tmp
if [ -n "$NGINX_404_REDIRECT" ]; then
    echo "NGINX_404_REDIRECT env is not supported anymore."
    sleep inf
fi

#tmp
if [ -n "$AUTH_REQUEST_AUTHENTIK_DOMAIN" ]; then
    echo "AUTH_REQUEST_AUTHENTIK_DOMAIN env is not supported anymore."
    sleep inf
fi

#tmp
if [ -n "$AUTH_REQUEST_TINYAUTH_DOMAIN" ]; then
    echo "AUTH_REQUEST_TINYAUTH_DOMAIN env is not supported anymore."
    sleep inf
fi

#tmp
if [ -n "$SKIP_IP_RANGES" ]; then
    echo "SKIP_IP_RANGES env is not supported anymore, please use TRUST_CLOUDFLARE"
    sleep inf
fi

#tmp
if [ -n "$CRT" ]; then
    echo "CRT env is not supported anymore, please use CERTBOT_RUN_INTERVAL"
    sleep inf
fi


#upstream
if [ -n "$DISABLE_RESOLVER" ]; then
    echo "DISABLE_RESOLVER env is not supported."
    sleep inf
fi

#upstream
if [ -n "$LE_SERVER" ]; then
    echo "LE_SERVER env is replaced by ACME_SERVER, please change it to ACME_SERVER."
    sleep inf
fi

#upstream
if [ -n "$LE_STAGING" ]; then
    echo "LE_STAGING env is not supported, please use ACME_SERVER."
    sleep inf
fi

#upstream
if [ -n "$DEBUG" ]; then
    echo "DEBUG env is not supported."
    sleep inf
fi

#upstream
if [ -n "$SKIP_CERTBOT_OWNERSHIP" ]; then
    echo "SKIP_CERTBOT_OWNERSHIP env is not supported."
    sleep inf
fi

#upstream
if [ -n "$IP_RANGES_FETCH_ENABLED" ]; then
    echo "IP_RANGES_FETCH_ENABLED env is not supported, please use TRUST_CLOUDFLARE"
    sleep inf
fi

#upstream
if [ -n "$NPM_ADMIN_PORT" ]; then
    echo "NPM_ADMIN_PORT env is not supported, please use NPM_PORT"
    sleep inf
fi

#upstream
if [ -n "$DB_SQLITE_FILE" ]; then
    echo "DB_SQLITE_FILE env is not supported, the database needs to be in /data/npmpro/database.sqlite."
    sleep inf
fi

#upstream
if [ -n "$X_FRAME_OPTIONS" ]; then
    echo "X_FRAME_OPTIONS env is not supported. It was moved to the WebUI."
    sleep inf
fi


if [ -z "$TZ" ] || [ ! -s /usr/share/zoneinfo/"$TZ" ]; then
    echo "TZ is invalid."
    sleep inf
fi


if ! echo "$ACME_SERVER" | grep -q "^https\?://"; then
    echo "ACME_SERVER needs to start with http:// or https://"
    sleep inf
fi

if [ -n "$ACME_EMAIL" ] && ! echo "$ACME_EMAIL" | grep -q "@"; then
    echo "ACME_EMAIL needs to contains @."
    sleep inf
fi

if { [ -n "$ACME_EAB_KID" ] || [ -n "$ACME_EAB_HMAC_KEY" ]; } && { [ -z "$ACME_EAB_KID" ] || [ -z "$ACME_EAB_HMAC_KEY" ] || [ -z "$ACME_EMAIL" ]; }; then
    echo "You need to set ACME_EAB_KID, ACME_EAB_HMAC_KEY and ACME_EMAIL (all are needed) or none of them or only ACME_EMAIL."
    sleep inf
fi

if ! echo "$ACME_MUST_STAPLE" | grep -q "^true$\|^false$"; then
    echo "ACME_MUST_STAPLE needs to be true or false."
    sleep inf
fi

if ! echo "$ACME_OCSP_STAPLING" | grep -q "^true$\|^false$"; then
    echo "ACME_OCSP_STAPLING needs to be true or false."
    sleep inf
fi

if ! echo "$ACME_KEY_TYPE" | grep -q "^ecdsa$\|^rsa$"; then
    echo "ACME_KEY_TYPE needs to be ecdsa or rsa."
    sleep inf
fi

if [ "$ACME_KEY_TYPE" = "ecdsa" ] && ! echo "$ACME_KEY_SIZE" | grep -q "^secp256r1$\|^secp384r1$\|^secp521r1$"; then
    echo "ACME_KEY_SIZE for ecdsa needs to be secp256r1, secp384r1, or secp521r1."
    sleep inf
fi

if [ "$ACME_KEY_TYPE" = "rsa" ] && ! echo "$ACME_KEY_SIZE" | grep -q "^2048$\|^3072$\|^4096$"; then
    echo "ACME_KEY_SIZE for rsa needs to be 2048, 3072, or 4096."
    sleep inf
fi

if ! echo "$ACME_SERVER_TLS_VERIFY" | grep -q "^true$\|^false$"; then
    echo "ACME_SERVER_TLS_VERIFY needs to be true or false."
    sleep inf
fi

if ! echo "$CUSTOM_OCSP_STAPLING" | grep -q "^true$\|^false$"; then
    echo "CUSTOM_OCSP_STAPLING needs to be true or false."
    sleep inf
fi

# acme-profile-check begin
# only a CA from the env (ACME_SERVER) or the default is read here, and a profile it does not list stops the start. A
# CA saved in Settings is not read at the start: it was typed in the UI, so only the backend reads it, through the
# outbound guard (the profile is checked there when it is saved).
if [ "$acme_server_stored" != true ] && [ "$ACME_PROFILE" != "none" ] && [ "$(curl -sSL --max-time 10 "$ACME_SERVER" | jq --arg p "$ACME_PROFILE" '.meta.profiles[$p]')" = "null" ]; then
    if [ "$(curl -sSL --max-time 10 "$ACME_SERVER" | jq -r ".newNonce")" = "null" ]; then
        echo "Cannot check if the ACME_PROFILE is supported by the ACME_SERVER since the ACME_SERVER is down."
    else
        echo "The ACME_PROFILE seems to be not supported by the ACME_SERVER."
        sleep inf
    fi
fi
# acme-profile-check end


if ! echo "$PUID" | grep -q "^[0-9]\+$"; then
    echo "PUID needs to be a number."
    sleep inf
fi

if ! echo "$PGID" | grep -q "^[0-9]\+$"; then
    echo "PGID needs to be a number"
    sleep inf
fi

if [ "$PGID" != "0" ] && [ "$PUID" = "0" ]; then
    echo "You've set PGID but not PUID. Which is required."
    sleep inf
fi

if [ "$PGID" = "0" ] && [ "$PUID" != "0" ]; then
    echo "You've set PUID but not PGID. Are you sure that this is what you wanted?"
fi


if ! echo "$NPM_PORT" | grep -q "^[0-9]\+$"; then
    echo "NPM_PORT needs to be a number."
    sleep inf
fi


if ! echo "$NPM_LISTEN_LOCALHOST" | grep -q "^true$\|^false$"; then
    echo "NPM_LISTEN_LOCALHOST needs to be true or false."
    sleep inf
fi

if [ "$NPM_LISTEN_LOCALHOST" = "true" ]; then
    export NPM_IPV4_BINDING="127.0.0.1"
    export NPM_IPV6_BINDING="[::1]"
fi



if ! echo "$HTTP_PORT" | grep -q "^[0-9]\+$"; then
    echo "HTTP_PORT needs to be a number."
    sleep inf
fi

if ! echo "$HTTPS_PORT" | grep -q "^[0-9]\+$"; then
    echo "HTTPS_PORT needs to be a number."
    sleep inf
fi

if ! echo "$IPV4_BINDING" | grep -q "^[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}$"; then
    echo "IPV4_BINDING needs to be a IPv4-Address: four blocks of numbers separated by dots."
    sleep inf
fi

if ! echo "$NPM_IPV4_BINDING" | grep -q "^[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}$"; then
    echo "NPM_IPV4_BINDING needs to be a IPv4-Address: four blocks of numbers separated by dots."
    sleep inf
fi


if ! echo "$IPV6_BINDING" | grep -q "^\[[0-9a-fA-F:]\+\]$"; then
    echo "IPV6_BINDING needs to be a IPv6-Address inside []: letters a-f or A-F, numbers 0-9 and colons."
    sleep inf
fi

if ! echo "$NPM_IPV6_BINDING" | grep -q "^\[[0-9a-fA-F:]\+\]$"; then
    echo "NPM_IPV6_BINDING needs to be a IPv6-Address inside []: letters a-f or A-F, numbers 0-9 and colons."
    sleep inf
fi

if ! echo "$DISABLE_IPV6" | grep -q "^true$\|^false$"; then
    echo "DISABLE_IPV6 needs to be true or false."
    sleep inf
fi


if ! echo "$DEFAULT_CERT_ID" | grep -q "^[0-9]\+$"; then
    echo "DEFAULT_CERT_ID needs to be a number."
    sleep inf
fi

if ! echo "$DISABLE_HTTP" | grep -q "^true$\|^false$"; then
    echo "DISABLE_HTTP needs to be true or false."
    sleep inf
fi

if [ "$HTTP_PORT" = "$HTTPS_PORT" ] && [ "$DISABLE_HTTP" = "false" ]; then
    echo "HTTP_PORT and HTTPS_PORT need to be different."
    sleep inf
fi

if ! echo "$LISTEN_PROXY_PROTOCOL" | grep -q "^true$\|^false$"; then
    echo "LISTEN_PROXY_PROTOCOL needs to be true or false."
    sleep inf
fi

if ! echo "$LISTEN_PROXY_PROTOCOL_HTTP" | grep -q "^true$\|^false$"; then
    echo "LISTEN_PROXY_PROTOCOL_HTTP needs to be true or false."
    sleep inf
fi

if ! echo "$LISTEN_PROXY_PROTOCOL_HTTPS" | grep -q "^true$\|^false$"; then
    echo "LISTEN_PROXY_PROTOCOL_HTTPS needs to be true or false."
    sleep inf
fi

if ! echo "$DISABLE_H3_QUIC" | grep -q "^true$\|^false$"; then
    echo "DISABLE_H3_QUIC needs to be true or false."
    sleep inf
fi

if ! echo "$ENABLE_MPTCP" | grep -q "^true$\|^false$"; then
    echo "ENABLE_MPTCP needs to be true or false."
    sleep inf
fi

if ! echo "$NGINX_QUIC_BPF" | grep -q "^true$\|^false$"; then
    echo "NGINX_QUIC_BPF needs to be true or false."
    sleep inf
fi

if ! echo "$NGINX_LOG_NOT_FOUND" | grep -q "^true$\|^false$"; then
    echo "NGINX_LOG_NOT_FOUND needs to be true or false."
    sleep inf
fi

if ! echo "$NGINX_WORKER_PROCESSES" | grep -q "^auto$\|^[0-9]\+$"; then
    echo "NGINX_WORKER_PROCESSES needs to be auto or a number."
    sleep inf
fi

if ! echo "$NGINX_WORKER_CONNECTIONS" | grep -q "^[0-9]\+$"; then
    echo "NGINX_WORKER_CONNECTIONS needs to be a number."
    sleep inf
fi

# an nginx time: numbers with a unit (ms, s, m, h, d), several can follow each other (1h30m); 0 means no limit
if ! echo "$NGINX_WORKER_SHUTDOWN_TIMEOUT" | grep -q "^0$\|^\([0-9]\+\(ms\|s\|m\|h\|d\)\)\+$"; then
    echo "NGINX_WORKER_SHUTDOWN_TIMEOUT needs to be 0 or an nginx time like 30s, 10m, 1h or 1h30m."
    sleep inf
fi

if ! echo "$NGINX_CPU_AFFINITY" | grep -Eq "^(off|auto|[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*)$"; then
    echo "NGINX_CPU_AFFINITY needs to be off, auto or a CPU list such as 16-19 or 16,18,20."
    sleep inf
fi

# DNS servers for nginx: space separated IPv4 addresses or IPv6 addresses in brackets, each with an optional :port;
# empty means the container's own resolvers
if [ -n "$NGINX_RESOLVER" ]; then
    if [ "$(echo "$NGINX_RESOLVER" | wc -w)" -gt 8 ]; then
        echo "NGINX_RESOLVER needs to have at most 8 addresses."
        sleep inf
    fi
    # the same rule as backend/lib/resolver-address.js: IPv4 octets 0 to 255 without leading zeros, an IPv6 address
    # in brackets, a port from 1 to 65535, no duplicates
    if ! echo "$NGINX_RESOLVER" | awk '
        function hex(g) { return g ~ /^[0-9A-Fa-f]+$/ && length(g) <= 4 }
        function v4(a,   p, n, i) {
            n = split(a, p, ".")
            if (n != 4) return 0
            for (i = 1; i <= 4; i++) if (p[i] !~ /^(0|[1-9][0-9]*)$/ || length(p[i]) > 3 || p[i] + 0 > 255) return 0
            return 1
        }
        # the number of 16 bit groups of a colon separated list, -1 when it is not valid
        function groups(list, tail,   p, n, i, c) {
            if (list == "") return 0
            n = split(list, p, ":")
            c = 0
            for (i = 1; i <= n; i++) {
                if (hex(p[i])) c++
                else if (tail && i == n && v4(p[i])) c += 2
                else return -1
            }
            return c
        }
        function v6(a,   at, l, r, gl, gr) {
            if (a !~ /^[0-9A-Fa-f:.]+$/ || a !~ /:/ || a ~ /:::/) return 0
            at = index(a, "::")
            if (at == 0) return groups(a, 1) == 8
            l = substr(a, 1, at - 1)
            r = substr(a, at + 2)
            if (index(r, "::") > 0) return 0
            gl = groups(l, 0)
            gr = groups(r, 1)
            return gl >= 0 && gr >= 0 && gl + gr <= 7
        }
        {
            for (w = 1; w <= NF; w++) {
                word = $w
                if (seen[word]++) exit 1
                port = ""
                if (substr(word, 1, 1) == "[") {
                    end = index(word, "]")
                    if (end == 0) exit 1
                    host = substr(word, 2, end - 2)
                    rest = substr(word, end + 1)
                    if (!v6(host)) exit 1
                } else {
                    colon = index(word, ":")
                    host = colon ? substr(word, 1, colon - 1) : word
                    rest = colon ? substr(word, colon) : ""
                    if (!v4(host)) exit 1
                }
                if (rest != "") {
                    if (rest !~ /^:[0-9]+$/ || length(rest) > 6) exit 1
                    port = substr(rest, 2) + 0
                    if (port < 1 || port > 65535) exit 1
                }
            }
        }
    '; then
        echo "NGINX_RESOLVER needs to be empty or space separated, unique IPv4 addresses or IPv6 addresses in brackets with an optional port, like 1.1.1.1 [2606:4700:4700::1111]:53."
        sleep inf
    fi
fi

if ! echo "$NGINX_RESOLVER_HOSTS" | grep -q "^true$\|^false$"; then
    echo "NGINX_RESOLVER_HOSTS needs to be true or false."
    sleep inf
fi

if ! echo "$NGINX_RESOLVER_IPV6" | grep -q "^true$\|^false$"; then
    echo "NGINX_RESOLVER_IPV6 needs to be true or false."
    sleep inf
fi

# empty (the TTL of each answer) or an nginx time in seconds or longer: a bare number (not 0) or parts with units
# y M w d h m s in this order, at most 32 characters, on one line; ms is refused by nginx for valid= (the setting's rule
# in backend/lib/runtime-rule-table.js isResolverValid)
if [ -n "$NGINX_RESOLVER_VALID" ]; then
    if [ "$(printf %s "$NGINX_RESOLVER_VALID" | wc -l)" != 0 ] || [ "${#NGINX_RESOLVER_VALID}" -gt 32 ] || [ "$NGINX_RESOLVER_VALID" = "0" ] ||
        ! printf %s "$NGINX_RESOLVER_VALID" | grep -Eq "^([0-9]+|([0-9]+y)?([0-9]+M)?([0-9]+w)?([0-9]+d)?([0-9]+h)?([0-9]+m)?([0-9]+s)?)$"; then
        echo "NGINX_RESOLVER_VALID needs to be empty or an nginx time in seconds or longer like 30s or 5m (not 0, no ms)."
        sleep inf
    fi
fi

if ! echo "$NGINX_FORCE_X25519MLKEM768" | grep -q "^true$\|^false$"; then
    echo "NGINX_FORCE_X25519MLKEM768 needs to be true or false."
    sleep inf
fi

if ! echo "$NGINX_TRUST_SECPR1" | grep -q "^true$\|^false$"; then
    echo "NGINX_TRUST_SECPR1 needs to be true or false."
    sleep inf
fi

if ! echo "$NGINX_TRUST_RSA_PKCS1" | grep -q "^true$\|^false$"; then
    echo "NGINX_TRUST_RSA_PKCS1 needs to be true or false."
    sleep inf
fi

if ! echo "$NGINX_DISABLE_TLS12" | grep -q "^true$\|^false$"; then
    echo "NGINX_DISABLE_TLS12 needs to be true or false."
    sleep inf
fi

if ! echo "$DISABLE_NGINX_BEAUTIFIER" | grep -q "^true$\|^false$"; then
    echo "DISABLE_NGINX_BEAUTIFIER needs to be true or false."
    sleep inf
fi

if [ -n "$TRUST_IP" ] && ! echo "$TRUST_IP" | grep -q "^[0-9a-fA-F.:/ ]\+$"; then
    echo "TRUST_IP can consist of space separated IPv4/IPv6 addresses or subnets."
    sleep inf
fi

if ! echo "$TRUST_CLOUDFLARE" | grep -q "^true$\|^false$"; then
    echo "TRUST_CLOUDFLARE needs to be true or false."
    sleep inf
fi

if ! echo "$LOGROTATE" | grep -q "^true$\|^false$"; then
    echo "LOGROTATE needs to be true or false."
    sleep inf
fi

if [ -n "$LOGROTATIONS" ] && ! echo "$LOGROTATIONS" | grep -q "^[0-9]\+$"; then
    echo "LOGROTATIONS needs to be a number."
    sleep inf
fi

# no default exported: the boot script tells "not set" from classic (it keeps the format the backend last wrote)
case "$NGINX_LOG_FORMAT" in
    "" | classic | json) ;;
    *)
        echo "NGINX_LOG_FORMAT needs to be classic or json."
        sleep inf
        ;;
esac

# no default exported: the boot script tells "not set" from false (it keeps the state the backend last wrote)
case "$NGINX_TLS_HANDSHAKE_LOG" in
    "" | true | false) ;;
    *)
        echo "NGINX_TLS_HANDSHAKE_LOG needs to be true or false."
        sleep inf
        ;;
esac

if [ -n "$TRAFFIC_STATS" ] && ! echo "$TRAFFIC_STATS" | grep -q "^true$\|^false$"; then
    echo "TRAFFIC_STATS needs to be true or false."
    sleep inf
fi

if [ -n "$TRAFFIC_SHOW_IPS" ] && ! echo "$TRAFFIC_SHOW_IPS" | grep -q "^true$\|^false$"; then
    echo "TRAFFIC_SHOW_IPS needs to be true or false."
    sleep inf
fi

if [ -n "$TRAFFIC_UNIQUE_VISITORS" ] && ! echo "$TRAFFIC_UNIQUE_VISITORS" | grep -q "^true$\|^false$"; then
    echo "TRAFFIC_UNIQUE_VISITORS needs to be true or false."
    sleep inf
fi

if [ -n "$TRAFFIC_VISITORS_CAP" ] && { ! echo "$TRAFFIC_VISITORS_CAP" | grep -Eq "^[0-9]{4,7}$" || [ "$TRAFFIC_VISITORS_CAP" -lt 1000 ] || [ "$TRAFFIC_VISITORS_CAP" -gt 1000000 ]; }; then
    echo "TRAFFIC_VISITORS_CAP needs to be a number between 1000 and 1000000."
    sleep inf
fi

if [ -n "$TRAFFIC_RETENTION_DAYS" ] && { ! echo "$TRAFFIC_RETENTION_DAYS" | grep -Eq "^[0-9]{1,3}$" || [ "$TRAFFIC_RETENTION_DAYS" -lt 7 ] || [ "$TRAFFIC_RETENTION_DAYS" -gt 365 ]; }; then
    echo "TRAFFIC_RETENTION_DAYS needs to be a number between 7 and 365."
    sleep inf
fi

if ! echo "$CERTBOT_RUN_INTERVAL" | grep -q "^[0-9]\+$" || [ "$CERTBOT_RUN_INTERVAL" -lt 1 ] || [ "$CERTBOT_RUN_INTERVAL" -ge 500 ]; then
    echo "CERTBOT_RUN_INTERVAL must be a number below 500."
    sleep inf
fi

if ! echo "$CERT_WARNING_DAYS" | grep -q "^[0-9]\+$" || [ "$CERT_WARNING_DAYS" -lt 1 ] || [ "$CERT_WARNING_DAYS" -gt 60 ]; then
    echo "CERT_WARNING_DAYS must be a number between 1 and 60."
    sleep inf
fi

if ! echo "$ECH_ROTATION_INTERVAL" | grep -q "^[0-9]\+$" || [ "$ECH_ROTATION_INTERVAL" -lt 1 ] || [ "$ECH_ROTATION_INTERVAL" -gt 24 ]; then
    echo "ECH_ROTATION_INTERVAL must be a number between 1 and 24."
    sleep inf
fi


if ! echo "$GOA" | grep -q "^true$\|^false$"; then
    echo "GOA needs to be true or false."
    sleep inf
fi

if echo "$GOACLA" | grep -vq "geoip-database"; then
    if [ -s /data/etc/goaccess/geoip/GeoLite2-City.mmdb ] || [ -s /data/etc/goaccess/geoip/GeoLite2-Country.mmdb ]|| [ -s /data/etc/goaccess/geoip/GeoLite2-ASN.mmdb ]; then
        echo "All goaccess geoip databases need to be moved from etc/goaccess/geoip to goaccess/geoip inside the mounted data folder!"
        sleep inf
    fi
    goaccess_geoip="$(geoip-goaccess-args.sh /data/goaccess/geoip)"
    if [ -n "$goaccess_geoip" ]; then
        export GOACLA="$GOACLA $goaccess_geoip"
    fi
fi

if [ -n "$GOACLA" ] && ! echo "$GOACLA" | grep -q "^-[a-zA-Z0-9 =/_.-]\+$"; then
    echo "GOACLA must start with a hyphen and can consist of lower and upper letters a-z A-Z, numbers 0-9, spaces, equals signs, slashes, underscores, dots and hyphens."
    sleep inf
fi


if ! echo "$PHP83" | grep -q "^true$\|^false$"; then
    echo "PHP83 needs to be true or false."
    sleep inf
fi

if [ -n "$PHP83_APKS" ] && [ "$PHP83" = "false" ]; then
    export PHP83="true"
    echo "setting PHP83 to true, since PHP83_APKS is set."
fi

if [ -n "$PHP83_APKS" ] && ! echo "$PHP83_APKS" | grep -q "^[a-z0-9 _-]\+$"; then
    echo "PHP83_APKS can consist of lower letters a-z, numbers 0-9, spaces, underscores and hyphens."
    sleep inf
fi


if ! echo "$PHP84" | grep -q "^true$\|^false$"; then
    echo "PHP84 needs to be true or false."
    sleep inf
fi

if [ -n "$PHP84_APKS" ] && [ "$PHP84" = "false" ]; then
    export PHP84="true"
    echo "setting PHP84 to true, since PHP84_APKS is set."
fi

if [ -n "$PHP84_APKS" ] && ! echo "$PHP84_APKS" | grep -q "^[a-z0-9 _-]\+$"; then
    echo "PHP84_APKS can consist of lower letters a-z, numbers 0-9, spaces, underscores and hyphens."
    sleep inf
fi


if ! echo "$PHP85" | grep -q "^true$\|^false$"; then
    echo "PHP85 needs to be true or false."
    sleep inf
fi

if [ -n "$PHP85_APKS" ] && [ "$PHP85" = "false" ]; then
    export PHP85="true"
    echo "setting PHP85 to true, since PHP85_APKS is set."
fi

if [ -n "$PHP85_APKS" ] && ! echo "$PHP85_APKS" | grep -q "^[a-z0-9 _-]\+$"; then
    echo "PHP85_APKS can consist of lower letters a-z, numbers 0-9, spaces, underscores and hyphens."
    sleep inf
fi


if [ -n "$PHP_APKS" ] && [ "$PHP83" = "false" ] && [ "$PHP84" = "false" ] && [ "$PHP85" = "false" ]; then
    echo "PHP_APKS is set, but PHP83, PHP84 and PHP85 is disabled."
    sleep inf
fi


if [ -n "$INITIAL_ADMIN_EMAIL" ] && ! echo "$INITIAL_ADMIN_EMAIL" | grep -q "@.*\."; then
    echo "INITIAL_ADMIN_EMAIL needs to contains a @ and one dot."
    sleep inf
fi

if [ -n "$INITIAL_ADMIN_PASSWORD" ] && { [ "${#INITIAL_ADMIN_PASSWORD}" -lt 8 ] || [ "${#INITIAL_ADMIN_PASSWORD}" -gt 255 ]; }; then
    echo "INITIAL_ADMIN_PASSWORD needs to be between 8 and 255 characters long."
    sleep inf
fi

if [ -n "$INITIAL_DEFAULT_PAGE" ] && ! echo "$INITIAL_DEFAULT_PAGE" | grep -q "^\(404\|444\|redirect\|congratulations\|html\)$"; then
    echo "INITIAL_DEFAULT_PAGE needs to be 404, 444, redirect, congratulations or html."
    sleep inf
fi

if { [ -n "$INITIAL_ADMIN_EMAIL" ] || [ -n "$INITIAL_ADMIN_PASSWORD" ]; } && { [ -z "$INITIAL_ADMIN_EMAIL" ] || [ -z "$INITIAL_ADMIN_PASSWORD" ]; }; then
    echo "You need to set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD (both are needed) or none of them."
    sleep inf
fi

if [ -n "$INITIAL_ADMIN_EMAIL" ] || [ -n "$INITIAL_ADMIN_PASSWORD" ] || [ -n "$INITIAL_DEFAULT_PAGE" ]; then
    echo "Remember to remove INITIAL_ envs after the first start."
    sleep 3
fi


if ! echo "$DISABLE_GRAVATAR" | grep -q "^true$\|^false$"; then
    echo "DISABLE_GRAVATAR needs to be true or false."
    sleep inf
fi


if ! echo "$NGINX_LOAD_NJS_MODULE" | grep -q "^true$\|^false$"; then
    echo "NGINX_LOAD_NJS_MODULE needs to be true or false."
    sleep inf
fi

if ! echo "$NGINX_LOAD_LDAP_MODULE" | grep -q "^true$\|^false$"; then
    echo "NGINX_LOAD_LDAP_MODULE needs to be true or false."
    sleep inf
fi

if ! echo "$NGINX_LOAD_NTLM_MODULE" | grep -q "^true$\|^false$"; then
    echo "NGINX_LOAD_NTLM_MODULE needs to be true or false."
    sleep inf
fi

if ! echo "$NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE" | grep -q "^true$\|^false$"; then
    echo "NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE needs to be true or false."
    sleep inf
fi


if [ -n "$OIDC_REDIRECT_DOMAIN" ] && echo "$OIDC_REDIRECT_DOMAIN" | grep -q "/"; then
    echo "OIDC_REDIRECT_DOMAIN must not contain /."
    sleep inf
fi

if [ -n "$OIDC_ISSUER_URL" ] && ! echo "$OIDC_ISSUER_URL" | grep -q "^https://"; then
    echo "OIDC_ISSUER_URL needs to start with https://."
    sleep inf
fi

if [ -n "$OIDC_REQUIRE_VERIFIED_EMAIL" ] && ! echo "$OIDC_REQUIRE_VERIFIED_EMAIL" | grep -q "^true$\|^false$"; then
    echo "OIDC_REQUIRE_VERIFIED_EMAIL needs to be true or false."
    sleep inf
fi

if [ -n "$OIDC_DISABLE_PASSWORD" ] && ! echo "$OIDC_DISABLE_PASSWORD" | grep -q "^true$\|^false$"; then
    echo "OIDC_DISABLE_PASSWORD needs to be true or false."
    sleep inf
fi

if [ -n "$OIDC_SKIP_MFA" ] && ! echo "$OIDC_SKIP_MFA" | grep -q "^true$\|^false$"; then
    echo "OIDC_SKIP_MFA needs to be true or false."
    sleep inf
fi

if [ -n "$MAIL_INVITATIONS" ] && ! echo "$MAIL_INVITATIONS" | grep -q "^true$\|^false$"; then
    echo "MAIL_INVITATIONS needs to be true or false."
    sleep inf
fi

if [ -n "$MAIL_ACCOUNT_NOTICES" ] && ! echo "$MAIL_ACCOUNT_NOTICES" | grep -q "^true$\|^false$"; then
    echo "MAIL_ACCOUNT_NOTICES needs to be true or false."
    sleep inf
fi

if [ -n "$SMTP_PORT" ] && { ! echo "$SMTP_PORT" | grep -q "^[0-9]\{1,5\}$" || [ "$SMTP_PORT" -lt 1 ] || [ "$SMTP_PORT" -gt 65535 ]; }; then
    echo "SMTP_PORT needs to be a number from 1 to 65535."
    sleep inf
fi

if [ -n "$SMTP_SECURITY" ] && ! echo "$SMTP_SECURITY" | grep -q "^starttls$\|^tls$\|^none$"; then
    echo "SMTP_SECURITY needs to be starttls, tls or none."
    sleep inf
fi

if [ -n "$SMTP_VERIFY_TLS" ] && ! echo "$SMTP_VERIFY_TLS" | grep -q "^true$\|^false$"; then
    echo "SMTP_VERIFY_TLS needs to be true or false."
    sleep inf
fi

# the characters of $1 that are in the tr set $2 (a set of tr -cd), counted
mail_count_chars() {
    printf '%s' "$1" | LC_ALL=C tr -cd "$2" | wc -c
}

# one plain address: printable ASCII only (no space, CR or LF), no quote, comma, colon, semicolon, angle bracket,
# parenthesis or backslash, no =?, at most 254 characters (the same rule as backend/lib/mail/settings-rules.js)
mail_address_ok() {
    [ "${#1}" -le 254 ] &&
        [ "$(mail_count_chars "$1" '\041-\176')" -eq "${#1}" ] &&
        printf '%s\n' "$1" | grep -qE '^[^@<>(),;:"\\]+@[^@<>(),;:"\\]+$' &&
        ! printf '%s' "$1" | grep -qF '=?'
}

for name in SMTP_FROM SMTP_REPLY_TO; do
    value="$(printenv "$name")"
    if [ -n "$value" ] && ! mail_address_ok "$value"; then
        echo "$name needs to be one plain address (printable ASCII, no name, no quotes, comma or angle brackets, at most 254 characters)."
        sleep inf
    fi
done

if [ -n "$SMTP_FROM_NAME" ] && { [ "${#SMTP_FROM_NAME}" -gt 100 ] || [ "$(mail_count_chars "$SMTP_FROM_NAME" '\r\n"')" -gt 0 ]; }; then
    echo "SMTP_FROM_NAME needs to be at most 100 characters without quotes or line breaks."
    sleep inf
fi

if [ -n "$SMTP_USERNAME" ] && { [ "${#SMTP_USERNAME}" -gt 254 ] || [ "$(mail_count_chars "$SMTP_USERNAME" '\r\n')" -gt 0 ]; }; then
    echo "SMTP_USERNAME needs to be at most 254 characters without line breaks."
    sleep inf
fi

if [ -n "$PASSWORD_RESET" ] && ! echo "$PASSWORD_RESET" | grep -q "^true$\|^false$"; then
    echo "PASSWORD_RESET needs to be true or false."
    sleep inf
fi

if [ -n "$PUBLIC_URL" ] && { ! echo "$PUBLIC_URL" | grep -qiE '^https://[^/?#@\\]+/?$' || [ "$(mail_count_chars "$PUBLIC_URL" '\041-\176')" -ne "${#PUBLIC_URL}" ]; }; then
    echo "PUBLIC_URL needs to be an https:// address without a path, query, fragment or user info."
    sleep inf
fi

# a comma list of at most 20 plain addresses (the backend checks each one again and lists a bad value in config_errors)
if [ -n "$ALERT_ADDRESSES" ]; then
    alert_count="$(printf '%s' "$ALERT_ADDRESSES" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -c .)"
    alert_bad="$(printf '%s' "$ALERT_ADDRESSES" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -c '[[:space:]<>"]')"
    if [ "$alert_count" -gt 20 ] || [ "$alert_bad" -gt 0 ]; then
        echo "ALERT_ADDRESSES needs to be a comma list of at most 20 plain addresses without spaces, < >, or quotes."
        sleep inf
    fi
fi

if [ -n "$MAIL_LANGUAGE" ] && ! echo "$MAIL_LANGUAGE" | grep -q "^\(en\|de\|zh\|fr\|es\|pt\|ru\|it\|nl\|pl\|ja\|ko\|uk\)$"; then
    echo "MAIL_LANGUAGE needs to be one of en, de, zh, fr, es, pt, ru, it, nl, pl, ja, ko, uk."
    sleep inf
fi


if ! echo "$AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES" | grep -q "^true$\|^false$"; then
    echo "AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES needs to be true or false."
    sleep inf
fi

# the same rule as the backend (UPSTREAM in lib/runtime-rules.js): no whitespace and no nginx syntax characters
AUTH_REQUEST_UPSTREAM_REGEX='^https\?://\(\([^/:;{}#"$\[:space:]'"'"']\+\|\[[a-fA-F0-9:]\+\]\):[0-9]\+\|cu_[^/:;{}#"$\[:space:]'"'"']\+\)$'
for name in ANUBIS TINYAUTH OAUTH2PROXY VOIDAUTH AUTHELIA AUTHENTIK; do
    eval "value=\${AUTH_REQUEST_${name}_UPSTREAM:-}"
    if [ -n "$value" ] && { [ "$(printf '%s\n' "$value" | wc -l)" -ne 1 ] || ! printf '%s\n' "$value" | grep -q "$AUTH_REQUEST_UPSTREAM_REGEX"; }; then
        echo "AUTH_REQUEST_${name}_UPSTREAM needs to contain the scheme, the target ip/domain/hostname and port or the scheme and the name of a cu_ upstream block but is not allowed to contain a path, whitespace or any of ; { } # \" ' \$ \\."
        sleep inf
    fi
done
unset name value


if [ "$ACME_MUST_STAPLE" = "true" ] && [ "$ACME_OCSP_STAPLING" = "false" ]; then
    export ACME_OCSP_STAPLING="true"
    echo "setting ACME_OCSP_STAPLING to true, since ACME_MUST_STAPLE is set to true."
fi

if [ "$LISTEN_PROXY_PROTOCOL" = "true" ] && [ "$LISTEN_PROXY_PROTOCOL_HTTP" = "false" ]; then
    export LISTEN_PROXY_PROTOCOL_HTTP="true"
    echo "setting LISTEN_PROXY_PROTOCOL_HTTP to true, since LISTEN_PROXY_PROTOCOL is set to true."
fi

if [ "$LISTEN_PROXY_PROTOCOL" = "true" ] && [ "$LISTEN_PROXY_PROTOCOL_HTTPS" = "false" ]; then
    export LISTEN_PROXY_PROTOCOL_HTTPS="true"
    echo "setting LISTEN_PROXY_PROTOCOL_HTTPS to true, since LISTEN_PROXY_PROTOCOL is set to true."
fi

if [ "$LISTEN_PROXY_PROTOCOL_HTTPS" = "true" ] && [ "$DISABLE_H3_QUIC" = "false" ]; then
    export DISABLE_H3_QUIC="true"
    echo "setting DISABLE_H3_QUIC to true, since LISTEN_PROXY_PROTOCOL_HTTPS is set to true."
fi

if [ "$LISTEN_PROXY_PROTOCOL_HTTP" != "$LISTEN_PROXY_PROTOCOL_HTTPS" ]; then
    echo "LISTEN_PROXY_PROTOCOL_HTTP and LISTEN_PROXY_PROTOCOL_HTTPS are different, please note that only the proxy protocol realip header will be read, but not the X-Forwarded-For http header."
fi

# the backend applies the same rule to the stored NGINX_FORCE_X25519MLKEM768 setting (runtime-rules.js)
if [ "$NGINX_FORCE_X25519MLKEM768" = "true" ] && [ "$NGINX_DISABLE_TLS12" = "false" ]; then
    export NGINX_DISABLE_TLS12="true"
    echo "setting NGINX_DISABLE_TLS12 to true, since NGINX_FORCE_X25519MLKEM768 is set to true."
fi

if [ "$NGINX_FORCE_X25519MLKEM768" = "true" ] && [ "$NGINX_TRUST_SECPR1" = "true" ]; then
    export NGINX_TRUST_SECPR1="false"
    echo "setting NGINX_TRUST_SECPR1 to false, since NGINX_FORCE_X25519MLKEM768 is set to true."
fi

if [ "$GOA" = "true" ] && [ "$LOGROTATE" = "false" ]; then
    export LOGROTATE="true"
    echo "setting LOGROTATE to true, since GOA is set to true."
fi


TV="29"
# NPMPRO_USER_RUNTIME_ENV: which runtime vars the env sets decides whether a template reads the env or the stored
# setting; the startup vars (TZ, PUID, ...) are left out, setting or unsetting them does not regenerate the hosts
ENV_SHA512SUM="$( (grep "env\.[A-Z0-9_]\+" -roh /app/templates | sed "s|env.||g" | sort | uniq | xargs printenv; echo "$NPMPRO_USER_RUNTIME_ENV"; echo "$TV") | tr -d "\n" | sha512sum | cut -d" " -f1)"
export ENV_SHA512SUM
if [ ! -s /data/npmpro/env.sha512sum ] || [ "$(cat /data/npmpro/env.sha512sum)" != "$ENV_SHA512SUM" ]; then
    echo "At least one env or the template version changed, all hosts will be regenerated. Please make sure to read the changelog."
    export REGENERATE_ALL="true"
fi

# the values healthcheck.sh (run as root by Docker) needs, so it never reads /data: root-owned, one KEY=value per line,
# parsed with fixed patterns
healthcheck_ipv4="$NPM_IPV4_BINDING"
if [ "$healthcheck_ipv4" = "0.0.0.0" ] || [ "$NPM_LISTEN_LOCALHOST" = "true" ]; then
    healthcheck_ipv4="127.0.0.1"
fi
healthcheck_snapshot="$(mktemp /etc/npmpro/.healthcheck.XXXXXX)"
printf 'NPM_PORT=%s\nNPM_IPV4_BINDING=%s\nGOA=%s\nPHP83=%s\nPHP84=%s\nPHP85=%s\n' \
    "$NPM_PORT" "$healthcheck_ipv4" "$GOA" "$PHP83" "$PHP84" "$PHP85" > "$healthcheck_snapshot"
chmod 644 "$healthcheck_snapshot"
mv -f "$healthcheck_snapshot" /etc/npmpro/healthcheck.env

exec start.sh
