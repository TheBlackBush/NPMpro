#!/usr/bin/env sh
# Checks that CHANGELOG.md keeps the Keep a Changelog layout the release workflow reads:
#   # Changelog, then ## [Unreleased], then ## [X.Y.Z] - YYYY-MM-DD sections with the newest version first,
#   inside a section only ### Added, Changed, Fixed, Security or Removed, each once and not empty,
#   and every release section with at least one list item.
# Usage: check-changelog.sh [changelog file]
file="${1:-CHANGELOG.md}"
if [ ! -r "$file" ]; then
    echo "::error::cannot read $file" >&2
    exit 1
fi
awk '
    function fail(msg) { printf "%s:%d: %s\n", FILENAME, NR, msg; bad = 1 }
    function close_list() { if (list != "" && items == 0) fail("### " list " has no list item") }
    function close_section() {
        close_list()
        if (section != "" && section != "Unreleased" && sitems == 0) fail("## [" section "] has no list item")
    }
    function newer(a, b,    x, y, i) {
        split(a, x, "."); split(b, y, ".")
        for (i = 1; i <= 3; i++) {
            if (x[i] + 0 > y[i] + 0) return 1
            if (x[i] + 0 < y[i] + 0) return 0
        }
        return 0
    }
    NR == 1 { if ($0 != "# Changelog") fail("the first line must be \"# Changelog\""); next }
    /\342\200\224/ { fail("an em dash") }
    /^## / {
        close_section()
        list = ""; items = 0; sitems = 0; delete seen
        sections++
        if (sections == 1) {
            if ($0 != "## [Unreleased]") fail("the first section must be \"## [Unreleased]\"")
            section = "Unreleased"
            next
        }
        if ($0 !~ /^## \[[0-9]+\.[0-9]+\.[0-9]+\] - [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/) {
            fail("a release heading must be \"## [X.Y.Z] - YYYY-MM-DD\": " $0)
            section = "?"
            next
        }
        v = $2; gsub(/[\[\]]/, "", v)
        if (v in versions) fail("version " v " appears twice")
        versions[v] = 1
        if (last != "" && !newer(last, v)) fail("version " v " must be older than " last " above it")
        last = v; section = v
        next
    }
    /^### / {
        if (sections == 0) { fail("### outside a section"); next }
        close_list()
        list = substr($0, 5); items = 0
        if (list !~ /^(Added|Changed|Fixed|Security|Removed)$/) fail("unknown list \"### " list "\" (Added, Changed, Fixed, Security, Removed)")
        if (list in seen) fail("### " list " appears twice in one section")
        seen[list] = 1
        next
    }
    /^#/ { fail("unexpected heading: " $0); next }
    /^- / {
        if (list == "") fail("a list item outside an ### list")
        items++; sitems++
        next
    }
    /^  / { if (list == "") fail("an indented line outside an ### list"); next }
    /^$/ { next }
    { if (sections > 0) fail("only list items, indented continuation lines and blank lines go in a section: " $0) }
    END {
        close_section()
        if (sections == 0) { FILENAME = FILENAME; fail("no ## [Unreleased] section") }
        exit bad
    }
' "$file" || exit 1
echo "$file keeps the changelog layout"
