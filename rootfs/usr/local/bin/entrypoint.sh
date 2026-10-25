#!/usr/bin/env sh

# before anything reads /data, so prerun scripts and envs.sh see the final layout
if ! migrate-data-folder.sh; then
    echo "The container does not start until the data folder problem above is fixed, waiting."
    sleep inf
fi

# not exported with its default: envs.sh records the variables the user set (NPMPRO_USER_ENV, Environment page)
prerun="${ENABLE_PRERUN:-false}"
if ! echo "$prerun" | grep -q "^true$\|^false$"; then
    echo "ENABLE_PRERUN needs to be true or false."
    sleep inf
fi

if [ -n "$(ls -A /data/prerun/*.sh 2> /dev/null)" ] && [ "$prerun" = "true" ]; then
    for script in /data/prerun/*.sh; do
        echo "Exexcuting prerun script: $script"
        chmod +x "$script"
        "$script"
    done
fi

exec envs.sh
