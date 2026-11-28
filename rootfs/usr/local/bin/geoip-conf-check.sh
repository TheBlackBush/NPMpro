#!/usr/bin/env sh
# Before nginx starts: a geoip_country line in geoip.conf that names a missing, empty, truncated or foreign file would
# stop nginx (a cold start fails on it). Then the file is rewritten to let every visitor pass, and the backend writes
# it again after start. The path is only used when it is a regular file (no link) under the GeoIP folder, and the
# file is only read for the MaxMind DB metadata marker (no GNU tools needed: tail, od, tr and case behave the same in
# busybox). Usage:
#   geoip-conf-check.sh [conf]            the check above
#   geoip-conf-check.sh --off [conf]      writes the off variant unconditionally
#   geoip-conf-check.sh --try-off [conf]  launch.sh, nginx -t failed: keeps the database variant in <conf>.database and
#                                         writes off, exit 1 when conf has no geoip_country line
#   geoip-conf-check.sh --settle [conf]   launch.sh, after the other fallbacks: puts the database variant back when
#                                         nginx -t passes with it, else off stays (a failing nginx -t keeps the old text)
set -u
mode=check
case "${1:-}" in
    --off | --try-off | --settle)
        mode="${1#--}"
        shift
        ;;
    *) ;;
esac
conf="${1:-/data/npmpro/nginx/geoip.conf}"
geoip_dir="${GEOIP_CHECK_DIR:-/data/goaccess/geoip}"
# the hex of 0xAB 0xCD 0xEF "MaxMind.com", the start of the metadata of every MaxMind DB
marker=abcdef4d61784d696e642e636f6d
off() {
    printf '%s\n' "# no usable GeoIP country database: country rules of access lists let every visitor pass (Settings, GeoIP)" "geo \$npmpro_geo_db {" "  default 0;" "}" > "$conf.tmp" && mv "$conf.tmp" "$conf"
}
has_database_line() {
    grep -q '^geoip_country[[:space:]]' "$conf" 2> /dev/null
}
case "$mode" in
    off)
        off
        exit 0
        ;;
    try-off)
        has_database_line || exit 1
        cp -p "$conf" "$conf.database" && off
        exit 0
        ;;
    settle)
        [ -f "$conf.database" ] || exit 0
        cp -p "$conf.database" "$conf"
        if ! nginx -tq; then
            off
            echo "GeoIP: nginx did not accept the GeoIP country database, the country rules of access lists let every visitor pass until it does (Settings, GeoIP)"
        fi
        rm -f "$conf.database"
        exit 0
        ;;
    *) ;;
esac
file="$(sed -n 's/^geoip_country[[:space:]]\{1,\}\([^;]*\);.*$/\1/p' "$conf" 2> /dev/null | head -n 1)"
[ -n "$file" ] || exit 0
reason=""
case "$file" in
    *..* | *[!A-Za-z0-9/._-]*) reason="is not a path under $geoip_dir" ;;
    "$geoip_dir"/*)
        if [ -L "$file" ]; then
            reason="is a link, only a regular file is used"
        elif [ ! -e "$file" ]; then
            reason="is missing"
        elif [ ! -f "$file" ]; then
            reason="is not a regular file"
        elif [ ! -s "$file" ]; then
            reason="is empty"
        else
            # a MaxMind DB ends with its metadata, which starts with the marker: a cut or foreign file lacks it
            hex="$(tail -c 131072 "$file" 2> /dev/null | od -An -tx1 -v | tr -d ' \n')"
            case "$hex" in
                *"$marker"*) ;;
                *) reason="is not a complete MaxMind DB" ;;
            esac
        fi
        ;;
    *) reason="is not a path under $geoip_dir" ;;
esac
if [ -n "$reason" ]; then
    off
    echo "GeoIP: $file $reason, the country rules of access lists let every visitor pass until a database is back (Settings, GeoIP)"
fi
