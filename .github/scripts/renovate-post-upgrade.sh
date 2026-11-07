#!/usr/bin/env sh
# Renovate runs this after it changed a Dockerfile pin that needs more than the new commit.
# Usage: renovate-post-upgrade.sh <depName> <new commit>
set -eu
dep="$1"
sha="$2"

hash_of() {
    out="$(mktemp)"
    curl -sSfL "$1" -o "$out"
    [ -s "$out" ] || { echo "empty answer from $1" >&2; exit 1; }
    sha256sum "$out" | cut -d" " -f1
    rm -f "$out"
}

set_hash() {
    sed -i "\\|$1|{n;s|[0-9a-f]\\{64\\}|$2|}" Dockerfile
}

case "$dep" in
    tomwassenberg/certbot-ocsp-fetcher)
        set_hash 'raw.githubusercontent.com/tomwassenberg' \
            "$(hash_of "https://raw.githubusercontent.com/tomwassenberg/certbot-ocsp-fetcher/$sha/certbot-ocsp-fetcher")"
        ;;
    crowdsecurity/lua-cs-bouncer)
        curl -sSfL "https://raw.githubusercontent.com/crowdsecurity/lua-cs-bouncer/$sha/config_example.conf" -o rootfs/etc/crowdsec.conf.original
        [ -s rootfs/etc/crowdsec.conf.original ] || { echo "empty bouncer config" >&2; exit 1; }
        ;;
    *)
        echo "no follow-up for $dep" >&2
        exit 1
        ;;
esac
