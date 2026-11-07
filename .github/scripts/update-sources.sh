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

# Replaces the hash on the line after the line that matches $1
set_hash() {
    sed -i "\\|$1|{n;s|[0-9a-f]\\{64\\}|$2|}" Dockerfile
}

pr_patch() {
    fetch "https://patch-diff.githubusercontent.com/raw/$1/pull/$2.patch" "$tmp/pr.patch"
    set_hash "pull/$2.patch" "$(hash_of "$tmp/pr.patch")"
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
sed -i "s|ARG DTR_VER=.*|ARG DTR_VER=$dtr_ver|" Dockerfile
set_hash "dynamic_tls_records" "$(hash_of "$tmp/dtr/nginx__dynamic_tls_records_$dtr_ver+.patch")"

# OpenResty patches
git clone --quiet --depth 1 https://github.com/openresty/openresty "$tmp/openresty"
orp_ver="$(find "$tmp/openresty/patches/nginx" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort -V | tail -1)"
sed -i "s|ARG ORP_VER=.*|ARG ORP_VER=$orp_ver|" Dockerfile
for patch in resolver_conf_parsing resolver_hosts upstream_pipelining reuseport_close_unused_fds; do
    set_hash "$patch" "$(hash_of "$tmp/openresty/patches/nginx/$orp_ver/nginx-$orp_ver-$patch.patch")"
done

# zlib-ng patch
git clone --quiet --depth 1 https://github.com/zlib-ng/patches "$tmp/zlib-ng"
znp_ver="$(
    find "$tmp/zlib-ng/nginx" -maxdepth 1 -name '*-zlib-ng.patch' -printf '%f\n' \
        | sed 's|\([0-9.]\+\)-zlib-ng.patch|\1|' | sort -V | tail -1
)"
sed -i "s|ARG ZNP_VER=.*|ARG ZNP_VER=$znp_ver|" Dockerfile
set_hash "zlib-ng.patch" "$(hash_of "$tmp/zlib-ng/nginx/$znp_ver-zlib-ng.patch")"

# OWASP headers to remove
fetch https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_remove.json "$tmp/headers.json"
jq -r '.headers[] | select(. != "Server") | "more_clear_headers \(tojson);"' "$tmp/headers.json" \
    > rootfs/usr/local/nginx/conf/headers-remove.conf

# CrowdSec bouncer config
fetch https://raw.githubusercontent.com/crowdsecurity/cs-nginx-bouncer/main/nginx/crowdsec_nginx.conf "$tmp/bouncer.conf"
cp "$tmp/bouncer.conf" rootfs/usr/local/nginx/conf/conf.d/crowdsec.conf.original
sed -i 's|crowdsec-nginx-bouncer/.*"|crowdsec-nginx-bouncer/version"|' rootfs/usr/local/nginx/conf/conf.d/crowdsec.conf.original

# nginxbeautifier: follows master, except a commit we do not take (Renovate can not skip one commit)
nbf_sha="$(git ls-remote https://github.com/vasilevich/nginxbeautifier master | cut -f1)"
if [ "$nbf_sha" != "ac5fd769a49c79bf2d750b6456a4565c6c99578d" ]; then
    sed -i "s|ARG NBF_VER=.*|ARG NBF_VER=$nbf_sha # master|" Dockerfile
    fetch "https://raw.githubusercontent.com/vasilevich/nginxbeautifier/$nbf_sha/index.js" "$tmp/index.js"
    # shellcheck disable=SC2016  # the Dockerfile text holds a literal $NBF_VER
    set_hash 'nginxbeautifier/"$NBF_VER"/index.js' "$(hash_of "$tmp/index.js")"
    fetch "https://raw.githubusercontent.com/vasilevich/nginxbeautifier/$nbf_sha/nginxbeautifier.js" "$tmp/nginxbeautifier.js"
    # shellcheck disable=SC2016  # the Dockerfile text holds a literal $NBF_VER
    set_hash 'nginxbeautifier/"$NBF_VER"/nginxbeautifier.js' "$(hash_of "$tmp/nginxbeautifier.js")"
fi
