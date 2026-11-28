#!/usr/bin/env sh
# Tests rootfs/usr/local/bin/geoip-goaccess-args.sh against temporary GeoIP folders.
# Run from backend/: sh test/geoip-goaccess-args.test.sh
set -u

SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/rootfs/usr/local/bin/geoip-goaccess-args.sh"
failures=0

check() {
    if [ "$2" = "0" ]; then
        echo "ok: $1"
    else
        echo "FAIL: $1"
        failures=$((failures + 1))
    fi
}

# usage: expect <name> <dir> <expected output>
expect() {
    actual="$(sh "$SCRIPT" "$2")"
    if [ "$actual" = "$3" ]; then
        check "$1" 0
    else
        echo "  expected: $3"
        echo "  actual:   $actual"
        check "$1" 1
    fi
}

# usage: fresh <file name>...  (non-empty files in a new folder, path in $dir)
fresh() {
    dir="$(mktemp -d)"
    for f in "$@"; do
        echo data > "$dir/$f"
    done
}

arg() { printf ' --geoip-database=%s/%s' "$dir" "$1"; }

fresh GeoLite2-Country.mmdb GeoLite2-ASN.mmdb
expect "no marker, GeoLite2 Country and ASN" "$dir" "$(arg GeoLite2-Country.mmdb | cut -c2-)$(arg GeoLite2-ASN.mmdb)"

fresh GeoLite2-City.mmdb GeoLite2-Country.mmdb GeoLite2-ASN.mmdb
expect "no marker, City, Country, ASN in that order" "$dir" "$(arg GeoLite2-City.mmdb | cut -c2-)$(arg GeoLite2-Country.mmdb)$(arg GeoLite2-ASN.mmdb)"

fresh dbip-country-lite.mmdb dbip-asn-lite.mmdb
expect "no marker, only DB-IP files" "$dir" "$(arg dbip-country-lite.mmdb | cut -c2-)$(arg dbip-asn-lite.mmdb)"

fresh GeoLite2-Country.mmdb dbip-country-lite.mmdb dbip-asn-lite.mmdb
expect "no marker, both sets give GeoLite2 only" "$dir" "$(arg GeoLite2-Country.mmdb | cut -c2-)"

fresh GeoLite2-Country.mmdb GeoLite2-ASN.mmdb dbip-country-lite.mmdb dbip-asn-lite.mmdb
echo dbip > "$dir/provider"
expect "marker dbip, both sets give DB-IP only" "$dir" "$(arg dbip-country-lite.mmdb | cut -c2-)$(arg dbip-asn-lite.mmdb)"
echo maxmind > "$dir/provider"
expect "marker maxmind, both sets give GeoLite2 only" "$dir" "$(arg GeoLite2-Country.mmdb | cut -c2-)$(arg GeoLite2-ASN.mmdb)"

fresh dbip-country-lite.mmdb dbip-asn-lite.mmdb
echo maxmind > "$dir/provider"
expect "marker maxmind, only DB-IP files give nothing" "$dir" ""

fresh GeoLite2-Country.mmdb
echo dbip > "$dir/provider"
expect "marker dbip, only GeoLite2 files give nothing" "$dir" ""

fresh dbip-country-lite.mmdb dbip-asn-lite.mmdb
echo "dbip " > "$dir/provider"
expect "marker with a trailing space and newline" "$dir" "$(arg dbip-country-lite.mmdb | cut -c2-)$(arg dbip-asn-lite.mmdb)"
printf 'dbip\r\n' > "$dir/provider"
expect "marker with CRLF" "$dir" "$(arg dbip-country-lite.mmdb | cut -c2-)$(arg dbip-asn-lite.mmdb)"

fresh GeoLite2-Country.mmdb dbip-country-lite.mmdb
echo "garbage; rm -rf /" > "$dir/provider"
expect "garbage marker is treated like no marker" "$dir" "$(arg GeoLite2-Country.mmdb | cut -c2-)"
fresh dbip-country-lite.mmdb
echo "../../etc/passwd" > "$dir/provider"
expect "path in the marker is treated like no marker" "$dir" "$(arg dbip-country-lite.mmdb | cut -c2-)"
fresh dbip-country-lite.mmdb
: > "$dir/provider"
expect "empty marker is treated like no marker" "$dir" "$(arg dbip-country-lite.mmdb | cut -c2-)"

fresh dbip-country-lite.mmdb
echo dbip > "$dir/provider"
expect "marker dbip, editions subset (Country only)" "$dir" "$(arg dbip-country-lite.mmdb | cut -c2-)"
fresh GeoLite2-ASN.mmdb
echo maxmind > "$dir/provider"
expect "marker maxmind, editions subset (ASN only)" "$dir" "$(arg GeoLite2-ASN.mmdb | cut -c2-)"

fresh GeoLite2-Country.mmdb dbip-country-lite.mmdb
: > "$dir/GeoLite2-Country.mmdb"
expect "an empty file is skipped" "$dir" "$(arg dbip-country-lite.mmdb | cut -c2-)"

fresh
expect "an empty folder gives an empty line" "$dir" ""
expect "a missing folder gives an empty line" "$dir/missing" ""

if [ "$failures" -gt 0 ]; then
    echo "$failures check(s) failed"
    exit 1
fi
echo "all checks passed"
