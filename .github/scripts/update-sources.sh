#!/usr/bin/env bash
# Refreshes pinned sources that have no version Renovate could track: upstream PR patches, patch folders, the OWASP
# header list and the CrowdSec bouncer config. Run from the repository root; changes files, the workflow opens the PR.
set -euo pipefail

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
base_url="${SOURCES_BASE_URL:-}"

# Downloads to $2 and refuses an empty answer
fetch() {
    curl -sSfL "${base_url:-}$1" -o "$2"
    if [ ! -s "$2" ]; then
        echo "empty answer from $1" >&2
        exit 1
    fi
}

hash_of() {
    sha256sum "$1" | cut -d" " -f1
}

# Replaces the hash on the line after the line that matches $1; refuses anything but 64 hex characters
set_hash() {
    case "$2" in
        *[!0-9a-f]*) echo "bad hash for $1" >&2; exit 1 ;;
    esac
    if [ "${#2}" -ne 64 ]; then
        echo "bad hash for $1" >&2
        exit 1
    fi
    sed -i "\\|$1|{n;s|[0-9a-f]\\{64\\}|$2|}" Dockerfile
}

# Stops the run when a version came out empty
need() {
    if [ -z "$2" ]; then
        echo "no version found for $1" >&2
        exit 1
    fi
}

# Stops the run unless the version is only digits and dots; a name from an upstream repository reaches sed otherwise
need_version() {
    need "$1" "$2"
    case "$2" in
        *[!0-9.]*) echo "unexpected characters in the $1 version" >&2; exit 1 ;;
    esac
}

pr_patch() {
    local h
    fetch "https://patch-diff.githubusercontent.com/raw/$1/pull/$2.patch" "$tmp/pr.patch"
    h="$(hash_of "$tmp/pr.patch")"
    set_hash "pull/$2.patch" "$h"
}

pr_patch nginx/nginx 689
pr_patch nginx/nginx 1333
pr_patch aperezdc/ngx-fancyindex 176

# dynamic_tls_records
git clone --quiet --depth 1 https://github.com/nginx-modules/ngx_http_tls_dyn_size "$tmp/dtr"
dtr_ver="$(
    find "$tmp/dtr" -maxdepth 1 -name 'nginx__dynamic_tls_records_*.patch' -printf '%f\n' \
        | sed 's|nginx__dynamic_tls_records_\([0-9.]\+\)+.patch|\1|' | sort -V | tail -1
)"
need_version dynamic_tls_records "$dtr_ver"
dtr_hash="$(hash_of "$tmp/dtr/nginx__dynamic_tls_records_$dtr_ver+.patch")"
sed -i "s|ARG DTR_VER=.*|ARG DTR_VER=$dtr_ver|" Dockerfile
set_hash "dynamic_tls_records" "$dtr_hash"

# OpenResty patches
git clone --quiet --depth 1 https://github.com/openresty/openresty "$tmp/openresty"
orp_ver="$(find "$tmp/openresty/patches/nginx" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort -V | tail -1)"
need_version openresty-patches "$orp_ver"
sed -i "s|ARG ORP_VER=.*|ARG ORP_VER=$orp_ver|" Dockerfile
for patch in resolver_conf_parsing resolver_hosts upstream_pipelining reuseport_close_unused_fds; do
    orp_hash="$(hash_of "$tmp/openresty/patches/nginx/$orp_ver/nginx-$orp_ver-$patch.patch")"
    set_hash "$patch" "$orp_hash"
done

# zlib-ng patch
git clone --quiet --depth 1 https://github.com/zlib-ng/patches "$tmp/zlib-ng"
znp_ver="$(
    find "$tmp/zlib-ng/nginx" -maxdepth 1 -name '*-zlib-ng.patch' -printf '%f\n' \
        | sed 's|\([0-9.]\+\)-zlib-ng.patch|\1|' | sort -V | tail -1
)"
need_version zlib-ng-patch "$znp_ver"
znp_hash="$(hash_of "$tmp/zlib-ng/nginx/$znp_ver-zlib-ng.patch")"
sed -i "s|ARG ZNP_VER=.*|ARG ZNP_VER=$znp_ver|" Dockerfile
set_hash "zlib-ng.patch" "$znp_hash"

# OWASP headers to remove
fetch https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_remove.json "$tmp/headers.json"
jq -r '.headers[] | select(. != "Server") | "more_clear_headers \(tojson);"' "$tmp/headers.json" > "$tmp/headers-remove.conf"
if [ ! -s "$tmp/headers-remove.conf" ]; then
    echo "no headers in the OWASP list" >&2
    exit 1
fi
cp "$tmp/headers-remove.conf" rootfs/usr/local/nginx/conf/headers-remove.conf

# CrowdSec bouncer config
fetch https://raw.githubusercontent.com/crowdsecurity/cs-nginx-bouncer/main/nginx/crowdsec_nginx.conf "$tmp/bouncer.conf"
cp "$tmp/bouncer.conf" rootfs/usr/local/nginx/conf/conf.d/crowdsec.conf.original
sed -i 's|crowdsec-nginx-bouncer/.*"|crowdsec-nginx-bouncer/version"|' rootfs/usr/local/nginx/conf/conf.d/crowdsec.conf.original

# nginxbeautifier: follows master, except a commit we do not take (Renovate can not skip one commit)
nbf_sha="$(git ls-remote https://github.com/vasilevich/nginxbeautifier master | cut -f1)"
need nginxbeautifier "$nbf_sha"
if [ "${#nbf_sha}" -ne 40 ] || [ -n "$(printf '%s' "$nbf_sha" | tr -d '0-9a-f')" ]; then
    echo "nginxbeautifier commit is not 40 lowercase hex characters" >&2
    exit 1
fi
if [ "$nbf_sha" != "ac5fd769a49c79bf2d750b6456a4565c6c99578d" ]; then
    fetch "https://raw.githubusercontent.com/vasilevich/nginxbeautifier/$nbf_sha/index.js" "$tmp/index.js"
    fetch "https://raw.githubusercontent.com/vasilevich/nginxbeautifier/$nbf_sha/nginxbeautifier.js" "$tmp/nginxbeautifier.js"
    nbf_index_hash="$(hash_of "$tmp/index.js")"
    nbf_main_hash="$(hash_of "$tmp/nginxbeautifier.js")"
    sed -i "s|ARG NBF_VER=.*|ARG NBF_VER=$nbf_sha # master|" Dockerfile
    # shellcheck disable=SC2016  # the Dockerfile text holds a literal $NBF_VER
    set_hash 'nginxbeautifier/"$NBF_VER"/index.js' "$nbf_index_hash"
    # shellcheck disable=SC2016  # the Dockerfile text holds a literal $NBF_VER
    set_hash 'nginxbeautifier/"$NBF_VER"/nginxbeautifier.js' "$nbf_main_hash"
fi
