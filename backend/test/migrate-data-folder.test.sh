#!/usr/bin/env sh
# shellcheck disable=SC2319 # the check lines intentionally pass the status of a test as the result
# Tests rootfs/usr/local/bin/migrate-data-folder.sh against temporary data folders.
# Run from backend/: sh test/migrate-data-folder.test.sh
set -u

SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/rootfs/usr/local/bin/migrate-data-folder.sh"
failures=0

check() {
    if [ "$2" = "0" ]; then
        echo "ok: $1"
    else
        echo "FAIL: $1"
        failures=$((failures + 1))
    fi
}

new_data() {
    dir="$(mktemp -d)"
    echo "$dir"
}

make_db() {
    node --no-warnings -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(process.argv[1]); db.exec("CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1)"); db.close();' "$1"
}

make_old() {
    mkdir -p "$1/npmplus/avatar" "$1/npmplus/backups"
    echo key > "$1/npmplus/keys-ec.json"
    echo img > "$1/npmplus/avatar/1.png"
    make_db "$1/npmplus/database.sqlite"
}

run() {
    MIGRATE_DATA_DIR="$1" sh "$SCRIPT" > "$1.log" 2>&1
    echo $?
}

backup_count() {
    find "$1" -maxdepth 1 -type d -name 'npmplus.backup-*' | wc -l | tr -d ' '
}

# only the old folder: moved, verified, backed up
d="$(new_data)"; make_old "$d"
code="$(run "$d")"
check "move exits 0" "$([ "$code" = 0 ]; echo $?)"
check "move creates npmpro with all files" "$([ -f "$d/npmpro/keys-ec.json" ] && [ -f "$d/npmpro/avatar/1.png" ] && [ -f "$d/npmpro/database.sqlite" ]; echo $?)"
check "move removes npmplus" "$([ ! -e "$d/npmplus" ]; echo $?)"
check "move leaves one backup" "$([ "$(backup_count "$d")" = 1 ]; echo $?)"
check "backup has the note" "$([ -f "$(find "$d" -maxdepth 1 -name 'npmplus.backup-*' | head -n1)/MOVED-TO-NPMPRO.txt" ]; echo $?)"
check "move leaves no tmp" "$([ ! -e "$d/npmpro.tmp" ]; echo $?)"

# both folders (for example a move interrupted after the commit): npmpro wins
d="$(new_data)"; make_old "$d"; mkdir -p "$d/npmpro"; echo mine > "$d/npmpro/marker"
code="$(run "$d")"
check "both exits 0" "$([ "$code" = 0 ]; echo $?)"
check "both keeps npmpro untouched" "$([ "$(cat "$d/npmpro/marker")" = mine ] && [ ! -e "$d/npmpro/keys-ec.json" ]; echo $?)"
check "both renames npmplus to a backup" "$([ ! -e "$d/npmplus" ] && [ "$(backup_count "$d")" = 1 ]; echo $?)"

# only the new folder: nothing to do
d="$(new_data)"; mkdir -p "$d/npmpro"; echo mine > "$d/npmpro/marker"
code="$(run "$d")"
check "new only exits 0 and changes nothing" "$([ "$code" = 0 ] && [ "$(cat "$d/npmpro/marker")" = mine ] && [ "$(backup_count "$d")" = 0 ]; echo $?)"

# neither folder: fresh install, nothing created
d="$(new_data)"
code="$(run "$d")"
check "fresh exits 0 and creates nothing" "$([ "$code" = 0 ] && [ -z "$(ls -A "$d")" ]; echo $?)"

# leftover tmp from an interrupted copy
d="$(new_data)"; make_old "$d"; mkdir -p "$d/npmpro.tmp"; echo half > "$d/npmpro.tmp/partial"
code="$(run "$d")"
check "leftover tmp is redone" "$([ "$code" = 0 ] && [ ! -e "$d/npmpro.tmp" ] && [ ! -e "$d/npmpro/partial" ] && [ -f "$d/npmpro/keys-ec.json" ]; echo $?)"

# corrupt database: fail, keep npmplus, leave nothing behind
d="$(new_data)"; make_old "$d"; echo "not a database" > "$d/npmplus/database.sqlite"
code="$(run "$d")"
check "corrupt db exits 1" "$([ "$code" = 1 ]; echo $?)"
check "corrupt db keeps npmplus and leaves no npmpro" "$([ -f "$d/npmplus/database.sqlite" ] && [ ! -e "$d/npmpro" ] && [ ! -e "$d/npmpro.tmp" ] && [ "$(backup_count "$d")" = 0 ]; echo $?)"

# unreadable file: the copy fails (root can read everything, so skipped as root)
if [ "$(id -u)" != 0 ]; then
    d="$(new_data)"; make_old "$d"; chmod 000 "$d/npmplus/keys-ec.json"
    code="$(run "$d")"
    check "unreadable file exits 1 and keeps npmplus" "$([ "$code" = 1 ] && [ -e "$d/npmplus/keys-ec.json" ] && [ ! -e "$d/npmpro" ]; echo $?)"
    chmod 600 "$d/npmplus/keys-ec.json"
else
    echo "skip: unreadable file (running as root)"
fi

if [ "$failures" != 0 ]; then
    echo "$failures check(s) failed"
    exit 1
fi
echo "all checks passed"
