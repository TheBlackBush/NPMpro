#!/usr/bin/env sh
# Tests check-changelog.sh and changelog-section.sh, then checks the real CHANGELOG.md. Run from the repository root.
check=.github/scripts/check-changelog.sh
section=.github/scripts/changelog-section.sh
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
failed=0

good() {
    cat > "$dir/c.md"
    sh "$check" "$dir/c.md" > "$dir/out" 2>&1 || { echo "FAIL: refused ($1):"; cat "$dir/out"; failed=1; }
}
bad() {
    cat > "$dir/c.md"
    if sh "$check" "$dir/c.md" > /dev/null 2>&1; then
        echo "FAIL: accepted ($1)"
        failed=1
    fi
}

cat > "$dir/full.md" <<'MD'
# Changelog

All notable changes to NPMpro.

## [Unreleased]

### Added

- **Hosts:** a new thing
  on two lines.

## [1.10.0] - 2027-02-01

### Fixed

- a fix

### Security

- a security fix

## [1.9.0] - 2027-01-01

### Added

- the first item
- the second item

## [1.0.0] - 2026-12-01

### Removed

- an old thing
MD
good "a full file" < "$dir/full.md"
good "an empty Unreleased" <<'MD'
# Changelog

## [Unreleased]

## [1.0.0] - 2026-12-01

### Added

- one
MD
good "only Unreleased" <<'MD'
# Changelog

## [Unreleased]

### Added

- one
MD
bad "no title" <<'MD'
## [Unreleased]
MD
bad "Unreleased not first" <<'MD'
# Changelog

## [1.0.0] - 2026-12-01

### Added

- one

## [Unreleased]
MD
bad "a heading without a date" <<'MD'
# Changelog

## [Unreleased]

## [1.0.0]

### Added

- one
MD
bad "a v in the version" <<'MD'
# Changelog

## [Unreleased]

## [v1.0.0] - 2026-12-01

### Added

- one
MD
bad "older version above a newer one" <<'MD'
# Changelog

## [Unreleased]

## [1.9.0] - 2027-01-01

### Added

- one

## [1.10.0] - 2027-02-01

### Added

- two
MD
bad "the same version twice" <<'MD'
# Changelog

## [Unreleased]

## [1.0.0] - 2026-12-01

### Added

- one

## [1.0.0] - 2026-12-01

### Fixed

- two
MD
bad "an unknown list" <<'MD'
# Changelog

## [Unreleased]

### Improvements

- one
MD
bad "a list twice in one section" <<'MD'
# Changelog

## [Unreleased]

### Added

- one

### Added

- two
MD
bad "an empty list" <<'MD'
# Changelog

## [Unreleased]

### Added

### Fixed

- one
MD
bad "an empty release" <<'MD'
# Changelog

## [Unreleased]

## [1.0.0] - 2026-12-01
MD
bad "a list item outside a list" <<'MD'
# Changelog

## [Unreleased]

- one
MD
bad "a paragraph inside a section" <<'MD'
# Changelog

## [Unreleased]

### Added

Some text.
MD
bad "a fourth-level heading" <<'MD'
# Changelog

## [Unreleased]

### Added

#### Hosts

- one
MD
bad "an em dash" <<EOF2
# Changelog

## [Unreleased]

### Added

- one $(printf '\342\200\224') two
EOF2
bad "a missing file" < /dev/null
rm -f "$dir/c.md"
if sh "$check" "$dir/c.md" > /dev/null 2>&1; then echo "FAIL: accepted (no file)"; failed=1; fi

# section: the notes of one version, without the heading and the blank lines around them
out="$(sh "$section" "$dir/full.md" 1.10.0)" || { echo "FAIL: section 1.10.0 refused"; failed=1; }
[ "$out" = "### Fixed

- a fix

### Security

- a security fix" ] || { echo "FAIL: section 1.10.0 gave: $out"; failed=1; }
out="$(sh "$section" "$dir/full.md" 1.0.0)" || { echo "FAIL: section 1.0.0 refused"; failed=1; }
[ "$out" = "### Removed

- an old thing" ] || { echo "FAIL: section 1.0.0 (the last one) gave: $out"; failed=1; }
out="$(sh "$section" "$dir/full.md" Unreleased)" || { echo "FAIL: section Unreleased refused"; failed=1; }
[ "$out" = "### Added

- **Hosts:** a new thing
  on two lines." ] || { echo "FAIL: section Unreleased gave: $out"; failed=1; }
# 1.0.0 must not match 1.0.00 or 11.0.0, 1.9 must not match 1.9.0
for v in 2.0.0 1.0 v1.0.0 1.9 ""; do
    if sh "$section" "$dir/full.md" "$v" > /dev/null 2>&1; then echo "FAIL: section '$v' accepted"; failed=1; fi
done
printf '# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-12-01\n' > "$dir/empty.md"
for v in Unreleased 1.0.0; do
    if sh "$section" "$dir/empty.md" "$v" > /dev/null 2>&1; then echo "FAIL: empty section $v accepted"; failed=1; fi
done
if sh "$section" "$dir/missing.md" 1.0.0 > /dev/null 2>&1; then echo "FAIL: a missing file accepted"; failed=1; fi

# the real file
sh "$check" CHANGELOG.md > /dev/null || { echo "FAIL: CHANGELOG.md"; sh "$check" CHANGELOG.md; failed=1; }

[ "$failed" = 0 ] && echo "changelog: all passed"
exit "$failed"
