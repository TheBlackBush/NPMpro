#!/usr/bin/env sh
# Tests release-version.sh. Run from the repository root.
script=.github/scripts/release-version.sh
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
failed=0

# pass <.version> <tag> <existing tags, space separated> <expected output>
pass() {
    printf '%s\n' "$1" > "$dir/v"
    echo "$3" | tr ' ' '\n' > "$dir/tags"
    out="$(sh "$script" "$dir/v" "$2" "$dir/tags")" || { echo "FAIL: '$1' with $2 was refused"; failed=1; return; }
    [ "$out" = "$4" ] || { echo "FAIL: '$1' with $2 and tags '$3' gave: $out"; failed=1; }
}

# refuse <.version> <tag> [existing tags file]
refuse() {
    printf '%s\n' "$1" > "$dir/v"
    if sh "$script" "$dir/v" "$2" ${3:+"$3"} > /dev/null 2>&1; then
        echo "FAIL: '$1' with $2 was accepted"
        failed=1
    fi
}

# the first release
pass 1.0.0 v1.0.0 "" "version=1.0.0
tags=1.0.0 1.0 1 latest
latest=true"
# no tag list given: the same as no earlier release
printf '1.2.3\n' > "$dir/v"
out="$(sh "$script" "$dir/v" v1.2.3)" || { echo "FAIL: no tag list was refused"; failed=1; }
[ "$out" = "version=1.2.3
tags=1.2.3 1.2 1 latest
latest=true" ] || { echo "FAIL: no tag list gave: $out"; failed=1; }
# a newer patch of the newest line moves everything
pass 1.2.4 v1.2.4 "v1.0.0 v1.2.3 v1.2.4" "version=1.2.4
tags=1.2.4 1.2 1 latest
latest=true"
# a patch of an older minor line: only X.Y.Z and X.Y
pass 1.1.5 v1.1.5 "v1.0.0 v1.1.4 v1.2.0" "version=1.1.5
tags=1.1.5 1.1
latest=false"
# a patch of an older major line: X.Y.Z, X.Y and X, not latest
pass 1.9.1 v1.9.1 "v1.9.0 v2.0.0" "version=1.9.1
tags=1.9.1 1.9 1
latest=false"
# an older patch inside a line that already has a newer one: only X.Y.Z
pass 1.2.3 v1.2.3 "v1.2.4" "version=1.2.3
tags=1.2.3
latest=false"
# numeric order, not text order: 1.10.0 is above 1.9.0, 10.0.0 above 9.0.0
pass 1.10.0 v1.10.0 "v1.9.0 v1.9.9" "version=1.10.0
tags=1.10.0 1.10 1 latest
latest=true"
pass 9.9.9 v9.9.9 "v10.0.0" "version=9.9.9
tags=9.9.9 9.9 9
latest=false"
# the line of 1.1 is not the line of 11.x or 1.10
pass 1.1.0 v1.1.0 "v11.0.0 v1.10.0" "version=1.1.0
tags=1.1.0 1.1
latest=false"
# other tags (not vX.Y.Z) are ignored
pass 2.0.0 v2.0.0 "v3.0.0-rc.1 nightly v1.0.0" "version=2.0.0
tags=2.0.0 2.0 2 latest
latest=true"
refuse 1.2.3 v1.2.4
refuse 1.2.3 1.2.3
refuse 1.2 v1.2
refuse 1.2.3-rc1 v1.2.3-rc1
refuse 1.2.3 v1.2.3-rc1
refuse "" v1.2.3
refuse 1.2.3 v1.2.3 "$dir/missing"

[ "$failed" = 0 ] && echo "release-version: all passed"
exit "$failed"
