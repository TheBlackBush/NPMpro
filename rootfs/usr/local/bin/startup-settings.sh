#!/usr/bin/env sh
# Sourced by envs.sh and healthcheck.sh. Reads the startup settings the backend writes when TZ or GOA is saved in the
# UI (backend/lib/runtime-rules.js renderStartupSettings). The file is data: it is never sourced or evaluated, each
# line is matched against a strict pattern and anything else is ignored.
#   GOA=true or GOA=false
#   goaccess_keep_days=1 to 366, goaccess_anonymize=off|1|2|3, goaccess_drop_query_strings, goaccess_real_os and
#   goaccess_resolve_hosts =true|false (GoAccess options: envs.sh turns them into fixed GOACLA flags)
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

# prints the name of the setting the line $1 sets (GOA, TZ or a goaccess_ option) when the line is valid, nothing otherwise; $2 is the
# zoneinfo folder
startup_setting_name() {
    case "$1" in
        GOA=true | GOA=false)
            echo GOA
            ;;
        goaccess_drop_query_strings=true | goaccess_drop_query_strings=false | goaccess_real_os=true | goaccess_real_os=false | goaccess_resolve_hosts=true | goaccess_resolve_hosts=false)
            echo "${1%%=*}"
            ;;
        goaccess_anonymize=off | goaccess_anonymize=1 | goaccess_anonymize=2 | goaccess_anonymize=3)
            echo goaccess_anonymize
            ;;
        goaccess_keep_days=[1-9] | goaccess_keep_days=[1-9][0-9] | goaccess_keep_days=[1-9][0-9][0-9])
            if [ "${1#goaccess_keep_days=}" -le 366 ]; then
                echo goaccess_keep_days
            fi
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

# prints the value of the setting $2 (GOA, TZ or a goaccess_ option) from the file $1, the last valid line wins; nothing when the file
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
            echo "Ignoring line $startup_setting_number of $1: only GOA, TZ and the goaccess_ options with valid values are read from it."
        fi
    done < "$1"
}

# prints GOACLA built from the GoAccess options in the file $1, with fixed flag text only (the values are validated
# words and numbers); without the file or an option its default applies, so no options give exactly the default
# GOACLA of envs.sh. $2: the zoneinfo folder (the option lines do not use it)
startup_settings_goacla() {
    startup_goacla_keep="$(startup_setting "$1" goaccess_keep_days "$2")"
    startup_goacla_anonymize="$(startup_setting "$1" goaccess_anonymize "$2")"
    startup_goacla_query="$(startup_setting "$1" goaccess_drop_query_strings "$2")"
    startup_goacla_os="$(startup_setting "$1" goaccess_real_os "$2")"
    startup_goacla_resolve="$(startup_setting "$1" goaccess_resolve_hosts "$2")"
    startup_goacla="--agent-list"
    [ "${startup_goacla_os:-true}" = "true" ] && startup_goacla="$startup_goacla --real-os"
    startup_goacla="$startup_goacla --double-decode"
    case "${startup_goacla_anonymize:-1}" in
        1) startup_goacla="$startup_goacla --anonymize-ip --anonymize-level=1" ;;
        2) startup_goacla="$startup_goacla --anonymize-ip --anonymize-level=2" ;;
        3) startup_goacla="$startup_goacla --anonymize-ip --anonymize-level=3" ;;
    esac
    case "${startup_goacla_keep:-30}" in
        *[!0-9]*) startup_goacla="$startup_goacla --keep-last=30" ;;
        *) startup_goacla="$startup_goacla --keep-last=${startup_goacla_keep:-30}" ;;
    esac
    [ "${startup_goacla_resolve:-true}" = "true" ] && startup_goacla="$startup_goacla --with-output-resolver"
    [ "${startup_goacla_query:-true}" = "true" ] && startup_goacla="$startup_goacla --no-query-string"
    printf '%s' "$startup_goacla"
}
