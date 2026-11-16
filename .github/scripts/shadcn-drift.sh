#!/usr/bin/env sh
# Lists the shadcn components in frontend/src/components/ui whose files differ from the shadcn registry today, as a
# Markdown report on stdout (the Monday workflow puts it in one issue). Read only: `shadcn add --diff` writes nothing,
# and the script fails if anything under src changed. Exits 1 when no component could be compared.
# Usage (from frontend/, after pnpm install, with no uncommitted change under src): sh ../.github/scripts/shadcn-drift.sh
set -u
version="$(node -p 'require("./package.json").devDependencies.shadcn')"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
: > "$dir/files"
: > "$dir/errors"
total=0
# the CLI prints one line per file it compared: "├ src/components/ui/button.jsx (overwrite)" when the registry has a
# different version, "(skip)" when it matches; a component counts as compared only when its own file has such a line
verdicts() { sed -nE 's/^├ (.*) \((overwrite|skip)\)$/\1 \2/p' "$1"; }
for file in src/components/ui/*.jsx; do
    name="$(basename "$file" .jsx)"
    total=$((total + 1))
    pnpm exec shadcn add "$name" --diff > "$dir/out" 2>&1
    verdicts "$dir/out" > "$dir/verdicts"
    if ! grep -q "^$file " "$dir/verdicts"; then
        # the CLI shows at most 5 files per component; ask for the component's own file when it was cut
        pnpm exec shadcn add "$name" --diff "$file" > "$dir/out" 2>&1
        verdicts "$dir/out" >> "$dir/verdicts"
    fi
    if ! grep -q "^$file " "$dir/verdicts"; then
        echo "$name" >> "$dir/errors"
        continue
    fi
    # a component's own run decides for its file: through another component the CLI can give another verdict for the
    # same file (field's run reports separator.jsx as changed, separator's own run as matching); files outside ui
    # (src/hooks/use-mobile.js) are only reached as a dependency
    awk -v own="$file" '$2 == "overwrite" && ($1 == own || $1 !~ /^src\/components\/ui\//) { print $1 }' \
        "$dir/verdicts" >> "$dir/files"
done
sort -u "$dir/files" -o "$dir/files"
failed="$(grep -c . "$dir/errors")"

echo "Components in \`frontend/src/components/ui\` compared with the shadcn registry, by the \`shadcn\` CLI $version"
echo "(\`pnpm exec shadcn add <name> --diff\`), $(date -u +%Y-%m-%d)."
echo
if [ "$failed" -gt 0 ]; then
    echo "Could not compare $failed components."
fi
if [ -s "$dir/files" ]; then
    [ "$failed" -gt 0 ] && echo
    echo "| File | Our edits |"
    echo "|---|---|"
    while read -r path; do
        if grep -q 'NPMpro:' "$path" 2>/dev/null; then edits="yes: port the upstream change by hand"; else edits="none: \`add --overwrite\`"; fi
        echo "| \`$path\` | $edits |"
    done < "$dir/files"
    echo
    echo "\`pnpm exec shadcn add <name> --diff\` in \`frontend/\` shows the change. Keep the \`// NPMpro:\` lines of our edits."
elif [ "$failed" -eq 0 ]; then
    echo "Every file matches the registry."
fi
if [ "$failed" -gt 0 ]; then
    echo
    echo "## Not compared"
    echo
    echo "The CLI printed no verdict for these components' own files:"
    echo
    sed 's/^/- /' "$dir/errors"
fi

changed="$(git status --porcelain -- src)"
if [ -n "$changed" ]; then
    echo >&2
    echo "The shadcn CLI changed files under frontend/src:" >&2
    echo "$changed" >&2
    exit 1
fi
if [ "$failed" -eq "$total" ]; then
    echo "No component could be compared." >&2
    exit 1
fi
