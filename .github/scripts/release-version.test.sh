#!/usr/bin/env sh
# Tests release-version.sh. Run from the repository root.
script=.github/scripts/release-version.sh
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
failed=0

pass() {
    file="$dir/v"
    printf '%s\n' "$1" > "$file"
    out="$(sh "$script" "$file" "$2")" || { echo "FAIL: '$1' with $2 was refused"; failed=1; return; }
    [ "$out" = "$3" ] || { echo "FAIL: '$1' with $2 gave: $out"; failed=1; }
}

refuse() {
    file="$dir/v"
    printf '%s\n' "$1" > "$file"
    if sh "$script" "$file" "$2" > /dev/null 2>&1; then
        echo "FAIL: '$1' with $2 was accepted"
        failed=1
    fi
}

pass 1.2.3 v1.2.3 "version=1.2.3
tags=1.2.3 1.2 1 latest"
pass 10.20.30 v10.20.30 "version=10.20.30
tags=10.20.30 10.20 10 latest"
refuse 1.2.3 v1.2.4
refuse 1.2.3 1.2.3
refuse 1.2 v1.2
refuse 1.2.3-rc1 v1.2.3-rc1
refuse 1.2.3 v1.2.3-rc1
refuse "" v1.2.3

[ "$failed" = 0 ] && echo "release-version: all passed"
exit "$failed"
