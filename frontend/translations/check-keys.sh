#!/usr/bin/env sh

if ! command -v jq > /dev/null 2>&1; then
	jq || exit 1
fi

SRC="$(dirname "$0")"

# static keys only: <T id="..."> and formatMessage({ id: "..." }), dynamic ids are not checked
missing=$(grep -rhoE '(<T id="|formatMessage\(\{ id: ")[a-z0-9][a-z0-9._-]*"' "$SRC/../src" | sed -E 's/.*"([^"]+)"$/\1/' | sort -u | while read -r key; do
	if ! jq -e --arg key "$key" 'has($key)' "$SRC/ui/en.json" > /dev/null; then
		echo "ui/en.json: missing key: $key"
	fi
done)

if [ -n "$missing" ]; then
	echo "$missing"
	exit 1
fi
