#!/usr/bin/env sh
# Checks a release tag against .version and prints the version, the image tags and whether it is the latest release,
# for GITHUB_OUTPUT. X.Y, X and latest move only when the version is the highest release of that line (latest: of all).
# Usage: release-version.sh <version file> <tag> [file with the existing tags, one per line]
version="$(tr -d '[:space:]' < "$1")"
tag="$2"
existing="${3:-/dev/null}"
if ! echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    echo "::error::.version must be MAJOR.MINOR.PATCH, got '$version'" >&2
    exit 1
fi
if [ "$tag" != "v$version" ]; then
    echo "::error::tag $tag does not match .version ($version)" >&2
    exit 1
fi
if [ ! -r "$existing" ]; then
    echo "::error::cannot read the list of existing tags: $existing" >&2
    exit 1
fi
minor="${version%.*}"
major="${version%%.*}"

# the release versions already tagged (vX.Y.Z only, this one left out) plus this one, highest last
versions="$( { grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' "$existing" | sed 's/^v//' | grep -vxF "$version"; echo "$version"; } \
    | sort -t. -k1,1n -k2,2n -k3,3n)"
highest_of() {
    printf '%s\n' "$versions" | grep -E "^$1" | tail -n 1
}

tags="$version"
[ "$(highest_of "$(echo "$minor" | sed 's/\./\\./g')\\.")" = "$version" ] && tags="$tags $minor"
[ "$(highest_of "$major\\.")" = "$version" ] && tags="$tags $major"
latest=false
if [ "$(highest_of '')" = "$version" ]; then
    tags="$tags latest"
    latest=true
fi
echo "version=$version"
echo "tags=$tags"
echo "latest=$latest"
