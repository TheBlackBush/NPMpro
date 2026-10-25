#!/usr/bin/env sh
# Sourced by envs.sh and healthcheck.sh. Reads the startup settings the backend writes when TZ or GOA is saved in the
# UI (backend/lib/runtime-rules.js renderStartupSettings). The file is data: it is never sourced or evaluated, each
# line is matched against a strict pattern and anything else is ignored.
#   GOA=true or GOA=false
#   TZ=<zone name>: letters, digits, _ + - and / between the parts, with a time zone file in /usr/share/zoneinfo

STARTUP_SETTINGS_FILE="${STARTUP_SETTINGS_FILE:-/data/npmpro/startup-settings.env}"
STARTUP_SETTINGS_ZONEINFO="${STARTUP_SETTINGS_ZONEINFO:-/usr/share/zoneinfo}"

# prints the name of the setting the line sets (GOA or TZ) when the line is valid, nothing otherwise
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
            if [ "${#startup_setting_tz}" -le 64 ] && [ -f "$STARTUP_SETTINGS_ZONEINFO/$startup_setting_tz" ] && [ -s "$STARTUP_SETTINGS_ZONEINFO/$startup_setting_tz" ]; then
                echo TZ
            fi
            ;;
    esac
}

# prints the value of the setting $1 (GOA or TZ) from the file, the last valid line wins; nothing when the file does
# not set it
startup_setting() {
    [ -f "$STARTUP_SETTINGS_FILE" ] || return 0
    startup_setting_value=""
    while IFS= read -r startup_setting_line || [ -n "$startup_setting_line" ]; do
        if [ "$(startup_setting_name "$startup_setting_line")" = "$1" ]; then
            startup_setting_value="${startup_setting_line#*=}"
        fi
    done < "$STARTUP_SETTINGS_FILE"
    printf '%s' "$startup_setting_value"
}

# reports every line of the file that is ignored (not empty, not a comment, not a valid setting)
startup_settings_warn() {
    [ -f "$STARTUP_SETTINGS_FILE" ] || return 0
    startup_setting_number=0
    while IFS= read -r startup_setting_line || [ -n "$startup_setting_line" ]; do
        startup_setting_number=$((startup_setting_number + 1))
        case "$startup_setting_line" in
            "" | "#"*) continue ;;
        esac
        if [ -z "$(startup_setting_name "$startup_setting_line")" ]; then
            echo "Ignoring line $startup_setting_number of $STARTUP_SETTINGS_FILE: only GOA=true, GOA=false and TZ=<a time zone> are read from it."
        fi
    done < "$STARTUP_SETTINGS_FILE"
}
