#!/usr/bin/env sh
# Prints the body of one section of CHANGELOG.md (the release notes of a version), without its heading and without
# blank lines at the start and end. Refuses a version that has no section or a section without a list item.
# Usage: changelog-section.sh <changelog file> <X.Y.Z | Unreleased>
file="$1"
want="$2"
if [ ! -r "$file" ]; then
    echo "::error::cannot read $file" >&2
    exit 1
fi
case "$want" in
    Unreleased) heading='## [Unreleased]' ;;
    *)
        if ! echo "$want" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
            echo "::error::the version must be MAJOR.MINOR.PATCH or Unreleased, got '$want'" >&2
            exit 1
        fi
        heading="## [$want] - "
        ;;
esac
body="$(awk -v heading="$heading" '
    /^## / {
        if (found) exit
        if (index($0, heading) == 1) { found = 1; next }
    }
    found { print }
' "$file" | sed -e '/./,$!d' | sed -e ':a' -e '/^\n*$/{$d;N;ba' -e '}')"
if ! printf '%s\n' "$body" | grep -q '^- '; then
    echo "::error::$file has no section for $want with at least one list item" >&2
    exit 1
fi
printf '%s\n' "$body"
