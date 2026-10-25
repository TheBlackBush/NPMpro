#!/usr/bin/env sh
# Fails when the old project name appears outside the places that must keep it.
# Wiki pages that need it: the NPMplus upgrade page (folder and table names) and the pages that link to it or cover
# its failed checks (Home, sidebar, Troubleshooting).
set -u

RENAME_MIGRATION="20261023180000_rename_to_npmpro.js"

hits="$(git grep -n -i npmplus -- . \
    ':!README.md' ':!COPYING' ':!MIT.LICENSE' \
    ':!wiki/Upgrading-from-NPMplus.md' ':!wiki/Home.md' ':!wiki/_Sidebar.md' ':!wiki/Troubleshooting.md' \
    ':!frontend/src/components/SiteFooter.jsx' \
    ':!backend/migrations' \
    ':!backend/test/*migration*.test.js' \
    ':!backend/test/migrate-data-folder.test.sh' \
    ':!rootfs/usr/local/bin/migrate-data-folder.sh' \
    ':!.github/scripts/check-names.sh' \
    | grep -v -e 'ZoeyVid/npmplus' -e 'crowdsec-npmplus-bouncer')"

# migrations up to the rename may keep the old names, newer ones may not
for file in $(git grep -l -i npmplus -- backend/migrations); do
    name="${file##*/}"
    latest="$(printf '%s\n%s\n' "$name" "$RENAME_MIGRATION" | sort | tail -n 1)"
    if [ "$name" != "$RENAME_MIGRATION" ] && [ "$latest" = "$name" ]; then
        hits="$hits
$file: migration newer than $RENAME_MIGRATION uses the old name"
    fi
done

hits="$(printf '%s\n' "$hits" | sed '/^$/d')"
if [ -n "$hits" ]; then
    echo "The old name npmplus is used outside the allowlist in .github/scripts/check-names.sh:"
    printf '%s\n' "$hits"
    exit 1
fi
echo "No stray npmplus names"
