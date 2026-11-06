#!/usr/bin/env sh
# Checks a release tag against .version and prints the version and the image tags for GITHUB_OUTPUT.
# Usage: release-version.sh <version file> <tag>
version="$(tr -d '[:space:]' < "$1")"
tag="$2"
if ! echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    echo "::error::.version must be MAJOR.MINOR.PATCH, got '$version'" >&2
    exit 1
fi
if [ "$tag" != "v$version" ]; then
    echo "::error::tag $tag does not match .version ($version)" >&2
    exit 1
fi
minor="${version%.*}"
major="${version%%.*}"
echo "version=$version"
echo "tags=$version $minor $major latest"
