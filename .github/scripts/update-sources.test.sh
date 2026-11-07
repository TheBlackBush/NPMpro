#!/usr/bin/env sh
# The update scripts must stop on a failed or empty download and refuse a bad hash, each for its own reason.
# Run from the repository root.
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
cp -r Dockerfile rootfs .github "$dir"/
cd "$dir" || exit 1
before="$(sha256sum Dockerfile)"
: > empty

# case <base url> <message that must appear>
download_case() {
    if SOURCES_BASE_URL="$1" bash .github/scripts/update-sources.sh > /dev/null 2> err; then
        echo "FAIL: the run went on with base $1"
        exit 1
    fi
    if ! grep -q "$2" err; then
        echo "FAIL: base $1 stopped for another reason:"
        cat err
        exit 1
    fi
    if [ "$before" != "$(sha256sum Dockerfile)" ]; then
        echo "FAIL: Dockerfile changed with base $1"
        exit 1
    fi
}
# the fragment makes curl read the local file whatever URL follows it
download_case "file://$dir/missing/" "curl:"
download_case "file://$dir/empty#" "empty answer from"

# set_hash must refuse a hash that is empty, short or not hex, and leave the Dockerfile alone
for script in update-sources.sh renovate-post-upgrade.sh; do
    for bad in "" abc "$(printf 'z%.0s' $(seq 64))"; do
        if (
            eval "$(sed -n '/^set_hash()/,/^}/p' ".github/scripts/$script")"
            set_hash dynamic_tls_records "$bad"
        ) > /dev/null 2> err; then
            echo "FAIL: $script set_hash accepted '$bad'"
            exit 1
        fi
        if ! grep -q "bad hash" err || [ "$before" != "$(sha256sum Dockerfile)" ]; then
            echo "FAIL: $script set_hash did not refuse '$bad' cleanly"
            exit 1
        fi
    done
done

# A version or commit that came from upstream must be checked before sed uses it. The fake git builds the trees the
# script reads; FAKE_BAD names the one value that is not plain. A run with no bad value must get to the end.
cp Dockerfile Dockerfile.orig
mkdir fakebin
cat > fakebin/git << 'EOF'
#!/bin/sh
good_sha=0123456789abcdef0123456789abcdef01234567
if [ "$1" = ls-remote ]; then
    sha="$good_sha"
    [ "$FAKE_BAD" = nbf ] && sha='0123456789abcdef0123456789abcdef0123456;'
    printf '%s\trefs/heads/master\n' "$sha"
    exit 0
fi
dest="$6"
mkdir -p "$dest"
dtr=1.2.3 orp=1.2.3 znp=1.2.3
[ "$FAKE_BAD" = dtr ] && dtr=';touch PWNED;'
[ "$FAKE_BAD" = orp ] && orp=';touch PWNED|e#'
[ "$FAKE_BAD" = znp ] && znp=';touch PWNED;'
case "$5" in
    *ngx_http_tls_dyn_size) echo p > "$dest/nginx__dynamic_tls_records_$dtr+.patch" ;;
    *openresty/openresty)
        mkdir -p "$dest/patches/nginx/$orp"
        for n in resolver_conf_parsing resolver_hosts upstream_pipelining reuseport_close_unused_fds; do
            echo p > "$dest/patches/nginx/$orp/nginx-$orp-$n.patch"
        done ;;
    *zlib-ng/patches)
        mkdir -p "$dest/nginx"
        echo p > "$dest/nginx/$znp-zlib-ng.patch" ;;
esac
EOF
chmod +x fakebin/git
printf '{"headers":["X-Test"]}\n' > ok.json
upstream_case() {
    rm -f PWNED
    if FAKE_BAD="$1" PATH="$dir/fakebin:$PATH" SOURCES_BASE_URL="file://$dir/ok.json#" \
        bash .github/scripts/update-sources.sh > /dev/null 2> err; then
        echo "FAIL: the run went on with a bad $1 value"
        exit 1
    fi
    if ! grep -q "$2" err || [ -e PWNED ]; then
        echo "FAIL: a bad $1 value was not refused cleanly:"
        cat err
        exit 1
    fi
}
upstream_case dtr "unexpected characters in the dynamic_tls_records version"
upstream_case orp "unexpected characters in the openresty-patches version"
upstream_case znp "unexpected characters in the zlib-ng-patch version"
upstream_case nbf "not 40 lowercase hex"
if ! FAKE_BAD=none PATH="$dir/fakebin:$PATH" SOURCES_BASE_URL="file://$dir/ok.json#" \
    bash .github/scripts/update-sources.sh > /dev/null 2> err; then
    echo "FAIL: a run with plain upstream values stopped:"
    cat err
    exit 1
fi

mv Dockerfile.orig Dockerfile

# renovate-post-upgrade.sh with a failing download keeps the hash line
mkdir bin
printf '#!/bin/sh\nexit 22\n' > bin/curl
chmod +x bin/curl
if PATH="$dir/bin:$PATH" sh .github/scripts/renovate-post-upgrade.sh tomwassenberg/certbot-ocsp-fetcher 0000 > /dev/null 2>&1; then
    echo "FAIL: renovate-post-upgrade.sh went on after a failed download"
    exit 1
fi
if [ "$before" != "$(sha256sum Dockerfile)" ]; then
    echo "FAIL: renovate-post-upgrade.sh changed the Dockerfile after a failed download"
    exit 1
fi
echo "update scripts: stop on a failed or empty download and refuse a bad hash"
