#!/usr/bin/env sh

# before anything reads /data, so prerun scripts and envs.sh see the final layout
if ! migrate-data-folder.sh; then
    exit 1
fi

export ENABLE_PRERUN="${ENABLE_PRERUN:-false}"
if ! echo "$ENABLE_PRERUN" | grep -q "^true$\|^false$"; then
    echo "ENABLE_PRERUN needs to be true or false."
    sleep inf
fi

if [ -n "$(ls -A /data/prerun/*.sh 2> /dev/null)" ] && [ "$ENABLE_PRERUN" = "true" ]; then
    for script in /data/prerun/*.sh; do
        echo "Exexcuting prerun script: $script"
        chmod +x "$script"
        "$script"
    done
fi

exec envs.sh
