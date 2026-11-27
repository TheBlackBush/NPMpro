#!/usr/bin/env sh
# The --geoip-database arguments for GoAccess: the files of the provider the backend wrote into <dir>/provider
# (Settings, GeoIP). Without that file, or with a value that is not a provider id (the first start of this version),
# the GeoLite2 files when any exists, as before, else the DB-IP files; never both sets. The file names are fixed here,
# nothing from the marker reaches the output. Usage: geoip-goaccess-args.sh [dir]
set -u
dir="${1:-/data/goaccess/geoip}"
provider="$(head -n 1 "$dir/provider" 2> /dev/null | tr -d ' \r')"
maxmind="GeoLite2-City.mmdb GeoLite2-Country.mmdb GeoLite2-ASN.mmdb"
dbip="dbip-country-lite.mmdb dbip-asn-lite.mmdb"
case "$provider" in
    maxmind | dbip) ;;
    *)
        provider=dbip
        for f in $maxmind; do
            [ -s "$dir/$f" ] && provider=maxmind
        done
        ;;
esac
if [ "$provider" = "maxmind" ]; then
    files="$maxmind"
else
    files="$dbip"
fi
out=""
for f in $files; do
    [ -s "$dir/$f" ] && out="$out --geoip-database=$dir/$f"
done
echo "${out# }"
