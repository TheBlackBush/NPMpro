#!/usr/bin/env sh
# Moves the data folder of NPMplus installs (/data/npmplus) to /data/npmpro once.
# The old folder is kept as /data/npmplus.backup-<date>, so the previous image can still be started.
set -u

DATA="${MIGRATE_DATA_DIR:-/data}"
OLD="$DATA/npmplus"
NEW="$DATA/npmpro"
TMP="$DATA/npmpro.tmp"

fail() {
    echo "Moving $OLD to $NEW failed: $1"
    echo "$OLD was not changed. Fix the cause and restart the container, or start the previous image."
    rm -rf "$TMP"
    exit 1
}

file_count() {
    find "$1" -type f | wc -l | tr -d ' '
}

byte_size() {
    find "$1" -type f -exec cat {} + | wc -c | tr -d ' '
}

backup_name() {
    name="$OLD.backup-$(date +%Y%m%d-%H%M)"
    n=1
    while [ -e "$name" ]; do
        name="$OLD.backup-$(date +%Y%m%d-%H%M)-$n"
        n=$((n + 1))
    done
    echo "$name"
}

keep_old() {
    backup="$(backup_name)"
    if ! mv "$OLD" "$backup"; then
        echo "Warning: could not rename $OLD to $backup, NPMpro uses $NEW anyway."
        return
    fi
    cat > "$backup/MOVED-TO-NPMPRO.txt" << EOT
NPMpro moved its data to $NEW on $(date).
This folder is the data as it was before the upgrade. NPMpro does not use it.

To go back to the previous image: stop the container, move $NEW away,
rename this folder back to $OLD and start the previous image.
With MySQL/MariaDB or Postgres, also restore the database dump you made before upgrading.

You can delete this folder once the upgrade works for you.
EOT
    echo "The old data folder is kept as $backup"
}

rm -rf "$TMP"

if [ ! -d "$OLD" ]; then
    exit 0
fi

if [ -d "$NEW" ]; then
    echo "Both $OLD and $NEW exist, using $NEW."
    keep_old
    exit 0
fi

need="$(du -sk "$OLD" | cut -f1)"
avail="$(df -Pk "$DATA" | awk 'NR == 2 {print $4}')"
if [ $((avail * 10)) -lt $((need * 11)) ]; then
    fail "not enough free space (${need} KiB plus 10% needed, ${avail} KiB free)"
fi

echo "Moving $OLD to $NEW..."
cp -a "$OLD" "$TMP" || fail "copy failed"
[ "$(file_count "$OLD")" = "$(file_count "$TMP")" ] || fail "the copy has a different number of files"
[ "$(byte_size "$OLD")" = "$(byte_size "$TMP")" ] || fail "the copy has a different size"

if [ -f "$TMP/database.sqlite" ]; then
    result="$(node --no-warnings -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(process.argv[1]); console.log(db.prepare("PRAGMA integrity_check").get().integrity_check); db.close();' "$TMP/database.sqlite" 2>&1)"
    [ "$result" = "ok" ] || fail "database integrity check of the copy failed: $result"
fi

mv "$TMP" "$NEW" || fail "could not rename $TMP to $NEW"
echo "Moved $OLD to $NEW"
keep_old
