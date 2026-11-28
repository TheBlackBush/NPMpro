#!/usr/bin/env sh
# Tests rootfs/usr/local/bin/geoip-conf-check.sh against temporary conf files and GeoIP folders.
# Run from backend/: sh test/geoip-conf-check.test.sh
set -u

SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/rootfs/usr/local/bin/geoip-conf-check.sh"
failures=0
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
GEOIP_CHECK_DIR="$work/geoip"
export GEOIP_CHECK_DIR
mkdir -p "$GEOIP_CHECK_DIR"

# shellcheck disable=SC2016
OFF='# no usable GeoIP country database: country rules of access lists let every visitor pass (Settings, GeoIP)
geo $npmpro_geo_db {
  default 0;
}'

check() {
    if [ "$2" = "0" ]; then
        echo "ok: $1"
    else
        echo "FAIL: $1"
        failures=$((failures + 1))
    fi
}

# a complete database stand-in: some bytes, then the metadata marker
good() { { head -c 2000 /dev/zero; printf '\253\315\357MaxMind.com{"binary_format_major_version":2}'; } > "$1"; }

database_conf() { printf '%s\n' "# GeoIP" "geoip_country $1;" "geo \$npmpro_geo_db {" "  default 1;" "}" > "$work/geoip.conf"; }

# usage: becomes_off <name>  (runs the check on $work/geoip.conf, expects the off text and the message)
becomes_off() {
    out="$(sh "$SCRIPT" "$work/geoip.conf")"
    [ "$(cat "$work/geoip.conf")" = "$OFF" ]
    a=$?
    case "$out" in "GeoIP: "*) b=0 ;; *) b=1 ;; esac
    check "$1" $((a + b))
}

# usage: stays <name>
stays() {
    cp "$work/geoip.conf" "$work/before.conf"
    out="$(sh "$SCRIPT" "$work/geoip.conf")"
    cmp -s "$work/before.conf" "$work/geoip.conf"
    a=$?
    [ -z "$out" ]
    b=$?
    check "$1" $((a + b))
}

good "$GEOIP_CHECK_DIR/ok.mmdb"
database_conf "$GEOIP_CHECK_DIR/ok.mmdb"
stays "a complete database stays byte for byte"

database_conf "$GEOIP_CHECK_DIR/gone.mmdb"
becomes_off "a deleted database becomes the off text"

: > "$GEOIP_CHECK_DIR/empty.mmdb"
database_conf "$GEOIP_CHECK_DIR/empty.mmdb"
becomes_off "an empty database becomes the off text"

head -c 10 "$GEOIP_CHECK_DIR/ok.mmdb" > "$GEOIP_CHECK_DIR/short.mmdb"
database_conf "$GEOIP_CHECK_DIR/short.mmdb"
becomes_off "a database truncated to 10 bytes becomes the off text"

head -c 1500 "$GEOIP_CHECK_DIR/ok.mmdb" > "$GEOIP_CHECK_DIR/cut.mmdb"
database_conf "$GEOIP_CHECK_DIR/cut.mmdb"
becomes_off "a database cut before its metadata becomes the off text"

echo "this is not a database, it is just some text that is long enough" > "$GEOIP_CHECK_DIR/text.mmdb"
database_conf "$GEOIP_CHECK_DIR/text.mmdb"
becomes_off "a file that is not a MaxMind DB becomes the off text"

echo "an error page that mentions MaxMind.com in its text, long enough to look like a file" > "$GEOIP_CHECK_DIR/page.mmdb"
database_conf "$GEOIP_CHECK_DIR/page.mmdb"
becomes_off "a text file that names MaxMind.com becomes the off text"

# the real Country database of the test fixtures
cp "$(dirname "$0")/fixtures/GeoLite2-Country-Test.mmdb" "$GEOIP_CHECK_DIR/real.mmdb"
database_conf "$GEOIP_CHECK_DIR/real.mmdb"
stays "a real Country database stays byte for byte"
# a big file: only its end is read
{ head -c 20000000 /dev/zero; cat "$GEOIP_CHECK_DIR/ok.mmdb"; } > "$GEOIP_CHECK_DIR/big.mmdb"
database_conf "$GEOIP_CHECK_DIR/big.mmdb"
stays "a large database stays byte for byte"

# the path from the content is only followed to a regular file under the GeoIP folder
good "$work/outside.mmdb"
database_conf "$work/outside.mmdb"
becomes_off "a complete database outside the GeoIP folder becomes the off text"
database_conf "$GEOIP_CHECK_DIR/../outside.mmdb"
becomes_off "a path with .. becomes the off text"
ln -s "$GEOIP_CHECK_DIR/ok.mmdb" "$GEOIP_CHECK_DIR/link.mmdb"
database_conf "$GEOIP_CHECK_DIR/link.mmdb"
becomes_off "a link becomes the off text"
case "$out" in *"is a link"*) check "a link has its own reason" 0 ;; *) check "a link has its own reason" 1 ;; esac
mkdir "$GEOIP_CHECK_DIR/dir.mmdb"
database_conf "$GEOIP_CHECK_DIR/dir.mmdb"
becomes_off "a folder becomes the off text"
case "$out" in *"not a regular file"*) check "a folder has its own reason" 0 ;; *) check "a folder has its own reason" 1 ;; esac
mkfifo "$GEOIP_CHECK_DIR/fifo.mmdb"
database_conf "$GEOIP_CHECK_DIR/fifo.mmdb"
becomes_off "a pipe becomes the off text (and the check does not hang)"

# the custom and off variants have no geoip_country line
printf '%s\n' "# geoip_country comes from /data/custom_nginx" "geo \$npmpro_geo_db {" "  default 1;" "}" > "$work/geoip.conf"
stays "the custom variant stays"
printf '%s\n' "$OFF" > "$work/geoip.conf"
stays "the off variant stays"
rm -f "$work/geoip.conf"
sh "$SCRIPT" "$work/geoip.conf" > /dev/null
missing=0
[ -e "$work/geoip.conf" ] && missing=1
check "a missing conf is not created" "$missing"

# --off writes the off text unconditionally
database_conf "$GEOIP_CHECK_DIR/ok.mmdb"
sh "$SCRIPT" --off "$work/geoip.conf"
off_ok=0
[ "$(cat "$work/geoip.conf")" = "$OFF" ] || off_ok=1
check "--off writes the off text" "$off_ok"

# launch.sh fallback: --try-off and --settle with a fake nginx that refuses a geoip_country line (REFUSE=1) or not
mkdir -p "$work/bin"
cat > "$work/bin/nginx" <<'FAKE'
#!/bin/sh
[ "${REFUSE:-0}" = 1 ] && grep -q '^geoip_country' "$FAKE_CONF" && exit 1
exit 0
FAKE
chmod +x "$work/bin/nginx"
FAKE_CONF="$work/geoip.conf"
export FAKE_CONF

database_conf "$GEOIP_CHECK_DIR/ok.mmdb"
cp "$work/geoip.conf" "$work/orig.conf"
PATH="$work/bin:$PATH" sh "$SCRIPT" --try-off "$work/geoip.conf"
if [ "$(cat "$work/geoip.conf")" = "$OFF" ] && cmp -s "$work/orig.conf" "$work/geoip.conf.database"; then
    check "--try-off writes off and keeps the database variant" 0
else
    check "--try-off writes off and keeps the database variant" 1
fi
out="$(REFUSE=1 PATH="$work/bin:$PATH" sh "$SCRIPT" --settle "$work/geoip.conf")"
if [ "$(cat "$work/geoip.conf")" = "$OFF" ] && [ ! -e "$work/geoip.conf.database" ] && [ -n "$out" ]; then
    check "--settle keeps off and says so when nginx refuses the database variant" 0
else
    check "--settle keeps off and says so when nginx refuses the database variant" 1
fi

database_conf "$GEOIP_CHECK_DIR/ok.mmdb"
PATH="$work/bin:$PATH" sh "$SCRIPT" --try-off "$work/geoip.conf"
out="$(REFUSE=0 PATH="$work/bin:$PATH" sh "$SCRIPT" --settle "$work/geoip.conf")"
if cmp -s "$work/orig.conf" "$work/geoip.conf" && [ ! -e "$work/geoip.conf.database" ] && [ -z "$out" ]; then
    check "--settle puts the database variant back when nginx accepts it" 0
else
    check "--settle puts the database variant back when nginx accepts it" 1
fi

printf '%s\n' "$OFF" > "$work/geoip.conf"
PATH="$work/bin:$PATH" sh "$SCRIPT" --try-off "$work/geoip.conf"
no_line=$?
if [ "$no_line" = 1 ] && [ ! -e "$work/geoip.conf.database" ]; then
    check "--try-off without a geoip_country line does nothing (exit 1)" 0
else
    check "--try-off without a geoip_country line does nothing (exit 1)" 1
fi
PATH="$work/bin:$PATH" sh "$SCRIPT" --settle "$work/geoip.conf"
[ "$(cat "$work/geoip.conf")" = "$OFF" ]
check "--settle without a saved variant does nothing" $?

if [ "$failures" -ne 0 ]; then
    echo "$failures failed"
    exit 1
fi
