#!/usr/bin/env sh

umask 022

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

# root runs these scripts, so only files root alone can change: the folder and each script owned by root, not a link
# and not writable by group or others (with PUID set, the rest of /data belongs to the PUID user)
root_only() {
    [ ! -L "$1" ] && [ "$(stat -c %u "$1")" = "0" ] && [ -z "$(find "$1" -maxdepth 0 -perm /022)" ]
}
if [ -n "$(ls -A /data/prerun/*.sh 2> /dev/null)" ] && [ "$prerun" = "true" ]; then
    if ! root_only /data/prerun || [ ! -d /data/prerun ]; then
        echo "Skipping the prerun scripts: /data/prerun must be a folder owned by root and not writable by group or others."
    else
        for script in /data/prerun/*.sh; do
            if [ -f "$script" ] && root_only "$script" && [ "$(stat -c %h "$script")" = "1" ]; then
                echo "Executing prerun script: $script"
                chmod +x "$script"
                "$script"
            else
                echo "Skipping prerun script $script: it must be a file owned by root, with one link, not writable by group or others."
            fi
        done
    fi
fi

exec envs.sh
