#!/usr/bin/env sh
# Lists the shadcn components in frontend/src/components/ui whose files differ from the shadcn registry today, as a
# Markdown report on stdout (the Monday workflow puts it in one issue). Read only: `shadcn add --diff` writes nothing.
# Usage (from frontend/, after pnpm install): sh ../.github/scripts/shadcn-drift.sh
set -u
version="$(node -p 'require("./package.json").devDependencies.shadcn')"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
: > "$dir/files"
: > "$dir/errors"
for file in src/components/ui/*.jsx; do
    name="$(basename "$file" .jsx)"
    if ! pnpm exec shadcn add "$name" --diff > "$dir/out" 2>&1; then
        echo "$name" >> "$dir/errors"
        continue
    fi
    # "├ src/components/ui/button.jsx (overwrite)": the registry has a different version of that file
    sed -n 's/^├ \(.*\) (overwrite)$/\1/p' "$dir/out" >> "$dir/files"
done
sort -u "$dir/files" -o "$dir/files"

echo "Components in \`frontend/src/components/ui\` compared with the shadcn registry, by the \`shadcn\` CLI $version"
echo "(\`pnpm exec shadcn add <name> --diff\`), $(date -u +%Y-%m-%d)."
echo
if [ -s "$dir/files" ]; then
    echo "| File | Our edits |"
    echo "|---|---|"
    while read -r path; do
        if grep -q 'NPMpro:' "$path" 2>/dev/null; then edits="yes: port the upstream change by hand"; else edits="none: \`add --overwrite\`"; fi
        echo "| \`$path\` | $edits |"
    done < "$dir/files"
    echo
    echo "\`pnpm exec shadcn add <name> --diff\` in \`frontend/\` shows the change. Keep the \`// NPMpro:\` lines of our edits."
else
    echo "Every file matches the registry."
fi
if [ -s "$dir/errors" ]; then
    echo
    echo "Not compared (the CLI failed): $(tr '\n' ' ' < "$dir/errors")"
fi
