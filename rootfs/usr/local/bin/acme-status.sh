#!/usr/bin/env sh
# Sourced by envs.sh. Prints the ACME block of the start log: the instance CA, whether certbot has an account for it
# and whether an email is set. It reads only certbot's account folders (never the network) and prints neither the email
# address nor the EAB values. A missing or unreadable folder means "not registered yet"; nothing here can fail the start.

# the name of a known CA directory URL
acme_ca_name() {
    case "$1" in
        "https://acme-v02.api.letsencrypt.org/directory") echo "Let's Encrypt" ;;
        "https://acme-staging-v02.api.letsencrypt.org/directory") echo "Let's Encrypt staging" ;;
        "https://acme.zerossl.com/v2/DV90") echo "ZeroSSL" ;;
        "https://dv.acme-v02.api.pki.goog/directory") echo "Google Trust Services" ;;
        *) echo "Custom CA" ;;
    esac
}

# prints the first 8 characters of the id of the newest account of the CA $1 under the accounts folder $2, nothing
# when there is none. The folders are the ones backend/lib/certbot-account.js accountDirsOf reads: the server path (the
# URL without its scheme) and, for Let's Encrypt, the v01 folder certbot reuses.
acme_account_id() {
    server_path="${1#*://}"
    case "$server_path" in
        "acme-v02.api.letsencrypt.org/directory") reused="acme-v01.api.letsencrypt.org/directory" ;;
        "acme-staging-v02.api.letsencrypt.org/directory") reused="acme-staging.api.letsencrypt.org/directory" ;;
        *) reused="" ;;
    esac
    newest=""
    for folder in "$2/$server_path" ${reused:+"$2/$reused"}; do
        for key in "$folder"/*/private_key.json; do
            [ -f "$key" ] || continue
            id="$(basename "$(dirname "$key")")"
            printf '%s' "$id" | grep -Eq '^[0-9a-f]{32}$' || continue
            if [ -z "$newest" ] || [ "$key" -nt "$newest" ]; then
                newest="$key"
            fi
        done
    done
    [ -n "$newest" ] || return 0
    id="$(basename "$(dirname "$newest")")"
    echo "$id" | cut -c 1-8
}

# acme_status <server> <source: env|settings|default> <accounts dir> <email set: true|false> [eab set: true|false]
acme_status() {
    case "$2" in
        env) acme_source="the environment" ;;
        settings) acme_source="Settings" ;;
        *) acme_source="the default" ;;
    esac
    echo "ACME CA:      $(acme_ca_name "$1") ($1), from $acme_source"
    acme_id="$(acme_account_id "$1" "$3" 2> /dev/null)"
    if [ -n "$acme_id" ]; then
        echo "ACME account: registered ($acme_id)"
    else
        echo "ACME account: not registered yet: registers when saved in Settings, Certificates, or at the first certificate request"
    fi
    if [ "$4" = "true" ]; then
        echo "ACME email:   set"
    else
        echo "ACME email:   not set"
    fi
    [ "$5" = "true" ] && echo "ACME EAB:     set"
    echo "-------------------------------------"
    return 0
}
