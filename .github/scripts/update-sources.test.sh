#!/usr/bin/env sh
# update-sources.sh must stop on a failed or empty download. Run from the repository root.
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
cp -r Dockerfile rootfs .github "$dir"/
cd "$dir" || exit 1
before="$(sha256sum Dockerfile)"
: > empty
# the fragment makes curl read the local file whatever URL follows it
for base in "file://$dir/missing/" "file://$dir/empty#"; do
    if SOURCES_BASE_URL="$base" bash .github/scripts/update-sources.sh > /dev/null 2>&1; then
        echo "FAIL: the run went on with base $base"
        exit 1
    fi
    if [ "$before" != "$(sha256sum Dockerfile)" ]; then
        echo "FAIL: Dockerfile changed with base $base"
        exit 1
    fi
done
echo "update-sources: stops on a failed or empty download"
