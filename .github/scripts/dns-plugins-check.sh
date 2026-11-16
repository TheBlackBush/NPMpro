#!/usr/bin/env sh
# Checks that every DNS plugin of backend/certbot/dns-plugins.json installs at its pinned version against the
# certbot versions of a running NPMpro container (pip --dry-run with the image's constraints, as the backend installs
# them). Only the plugins in BROKEN may fail: deprecated providers whose package no longer installs at all (they stay
# listed for what already uses them, which could not renew before either). Any other failure fails the check, a
# deprecated provider that still renews existing certificates (such as the old Beget plugin) included.
# Usage: dns-plugins-check.sh <container> [dns-plugins.json]   (needs docker and jq; 8 plugins at a time)
set -u
BROKEN="cloudxns constellix corenetworks dnspod googledomains oci"
if [ "$#" -lt 1 ]; then
    echo "usage: $0 <container> [dns-plugins.json]" >&2
    exit 2
fi
container="$1"
plugins="${2:-backend/certbot/dns-plugins.json}"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT

jq -r 'to_entries[] | "\(.key) \(.value.package_name)==\(.value.version) \(.value.deprecated // false)"' "$plugins" \
    > "$dir/list" || { echo "::error::cannot read $plugins" >&2; exit 1; }

# one line per plugin in $dir/<key>: "ok", "held <reason>" or "FAIL <reason>"
# shellcheck disable=SC2016 # the inner script expands its own arguments
CONTAINER="$container" OUT="$dir" BROKEN="$BROKEN" xargs -P 8 -L 1 sh -c '
    if err="$(docker exec "$CONTAINER" pip install --dry-run --quiet --no-cache-dir \
        --constraint /usr/local/share/npmpro/certbot-constraints.txt "$1" 2>&1)"; then
        echo ok > "$OUT/$0"
    else
        reason="$(printf "%s\n" "$err" | grep -m 1 -E "ERROR|error:" || printf "%s\n" "$err" | tail -n 1)"
        case " $BROKEN " in
            *" $0 "*) [ "$2" = true ] && held=1 || held=0 ;;
            *) held=0 ;;
        esac
        if [ "$held" = 1 ]; then echo "held $reason" > "$OUT/$0"; else echo "FAIL $reason" > "$OUT/$0"; fi
    fi
' < "$dir/list"

failed=0
total=0
while read -r key package deprecated; do
    total=$((total + 1))
    result="$(cat "$dir/$key" 2>/dev/null || echo "FAIL no result")"
    case "$result" in
        ok) [ "$deprecated" = true ] && echo "note: the deprecated $key ($package) installs" ;;
        held*) echo "held: $key ($package), deprecated: ${result#held }" ;;
        *) echo "::error::$key ($package) does not install: ${result#FAIL }"; failed=$((failed + 1)) ;;
    esac
done < "$dir/list"
if [ "$total" -eq 0 ]; then
    echo "::error::$plugins lists no DNS plugin" >&2
    exit 1
fi
if [ "$failed" -gt 0 ]; then
    echo "$failed of $total DNS plugins do not install"
    exit 1
fi
echo "every DNS plugin installs except the known broken ones ($total checked)"
