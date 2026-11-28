#!/usr/bin/env sh
# Before nginx starts: a geoip_country line in geoip.conf that names a missing, empty, truncated or foreign file would
# stop nginx (a cold start fails on it). Then the file is rewritten to let every visitor pass, and the backend writes
# it again after start. The path is only used when it is a regular file (no link) under the GeoIP folder, and the
# file is only read for the MaxMind DB metadata marker. Usage: geoip-conf-check.sh [conf]. With --off [conf] it
# writes the off variant unconditionally.
set -u
conf="${1:-/data/npmpro/nginx/geoip.conf}"
geoip_dir="${GEOIP_CHECK_DIR:-/data/goaccess/geoip}"
off() {
    printf '%s\n' "# no usable GeoIP country database: country rules of access lists let every visitor pass (Settings, GeoIP)" "geo \$npmpro_geo_db {" "  default 0;" "}" > "$conf"
}
if [ "${1:-}" = "--off" ]; then
    conf="${2:-/data/npmpro/nginx/geoip.conf}"
    off
    exit 0
fi
file="$(sed -n 's/^geoip_country[[:space:]]\{1,\}\([^;]*\);.*$/\1/p' "$conf" 2> /dev/null | head -n 1)"
[ -n "$file" ] || exit 0
reason=""
case "$file" in
    *..* | *[!A-Za-z0-9/._-]*) reason="is not a path under $geoip_dir" ;;
    "$geoip_dir"/*)
        if [ -L "$file" ] || [ ! -f "$file" ] || [ ! -s "$file" ]; then
            reason="is missing or empty"
        elif ! tail -c 131072 "$file" 2> /dev/null | grep -aq 'MaxMind\.com'; then
            # a MaxMind DB ends with its metadata, which starts with this marker: a cut or foreign file lacks it
            reason="is not a complete MaxMind DB"
        fi
        ;;
    *) reason="is not a path under $geoip_dir" ;;
esac
if [ -n "$reason" ]; then
    off
    echo "GeoIP: $file $reason, the country rules of access lists let every visitor pass until a database is back (Settings, GeoIP)"
fi
