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
