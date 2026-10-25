#!/usr/bin/env sh
# Sourced by envs.sh and healthcheck.sh. Reads the startup settings the backend writes when TZ or GOA is saved in the
# UI (backend/lib/runtime-rules.js renderStartupSettings). The file is data: it is never sourced or evaluated, each
# line is matched against a strict pattern and anything else is ignored.
#   GOA=true or GOA=false
#   TZ=<zone name>: like backend/lib/time-zones.js isTimeZone: letters, digits, _ + - and / between the parts, at most
#   64 characters, not posix/, right/, posixrules, localtime or Factory, and a TZif file in the zoneinfo folder
# The callers pass the file (and the tests their own zoneinfo folder); a file that is not a regular file (a link, a
# FIFO, a device) or is larger than 4096 bytes is not read at all.

STARTUP_SETTINGS_MAX_BYTES=4096

# true when the file can be read: a regular file, not a symlink, at most STARTUP_SETTINGS_MAX_BYTES; prints why not
# when $2 is "log"
startup_settings_readable() {
    [ -e "$1" ] || [ -L "$1" ] || return 1
    if [ -L "$1" ] || [ ! -f "$1" ]; then
        [ "$2" = "log" ] && echo "Ignoring $1: it is not a regular file."
        return 1
    fi
    if [ "$(wc -c < "$1" | tr -d ' ')" -gt "$STARTUP_SETTINGS_MAX_BYTES" ]; then
        [ "$2" = "log" ] && echo "Ignoring $1: it is larger than $STARTUP_SETTINGS_MAX_BYTES bytes."
        return 1
    fi
    return 0
}

# prints the name of the setting the line $1 sets (GOA or TZ) when the line is valid, nothing otherwise; $2 is the
# zoneinfo folder
startup_setting_name() {
    case "$1" in
        GOA=true | GOA=false)
            echo GOA
            ;;
        TZ=*)
            startup_setting_tz="${1#TZ=}"
            case "$startup_setting_tz" in
                "" | /* | */ | *//* | *[!A-Za-z0-9_+/-]*) return 0 ;;
            esac
            case "${startup_setting_tz%%/*}" in
                posix | right | posixrules | localtime | Factory) return 0 ;;
            esac
            startup_setting_zone="$2/$startup_setting_tz"
            # a zone may be a link to another one (tzdata), like the backend's stat
            if [ "${#startup_setting_tz}" -le 64 ] && [ -f "$startup_setting_zone" ] && [ "$(dd if="$startup_setting_zone" bs=4 count=1 2> /dev/null)" = "TZif" ]; then
                echo TZ
            fi
            ;;
    esac
}

# prints the value of the setting $2 (GOA or TZ) from the file $1, the last valid line wins; nothing when the file
# does not set it. $3: the zoneinfo folder, /usr/share/zoneinfo by default
startup_setting() {
    startup_settings_readable "$1" || return 0
    startup_setting_value=""
    while IFS= read -r startup_setting_line || [ -n "$startup_setting_line" ]; do
        if [ "$(startup_setting_name "$startup_setting_line" "${3:-/usr/share/zoneinfo}")" = "$2" ]; then
            startup_setting_value="${startup_setting_line#*=}"
        fi
    done < "$1"
    printf '%s' "$startup_setting_value"
}

# reports why the file $1 is not read, or every line of it that is ignored (not empty, not a comment, not a valid
# setting). $2: the zoneinfo folder, /usr/share/zoneinfo by default
startup_settings_warn() {
    startup_settings_readable "$1" log || return 0
    startup_setting_number=0
    while IFS= read -r startup_setting_line || [ -n "$startup_setting_line" ]; do
        startup_setting_number=$((startup_setting_number + 1))
        case "$startup_setting_line" in
            "" | "#"*) continue ;;
        esac
        if [ -z "$(startup_setting_name "$startup_setting_line" "${2:-/usr/share/zoneinfo}")" ]; then
            echo "Ignoring line $startup_setting_number of $1: only GOA=true, GOA=false and TZ=<a time zone> are read from it."
        fi
    done < "$1"
}
