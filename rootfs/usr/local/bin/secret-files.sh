#!/usr/bin/env sh
# Sourced by envs.sh, which calls secret_files_read once as root, right after the .env file of the data folder and
# before anything reads the variables. For each listed NAME with NAME_FILE set, the content of that file becomes NAME
# (exported) and NAME_FILE is unset, the way Docker and Compose secrets (/run/secrets/<name>) are used. Trailing
# newlines are removed and nothing else changes. A refused file stops the start with one line that names the variable
# and the path, never the content. The data folder comes from the caller (the tests pass their own): the PUID user can
# change files there, so a path in it, or a link into it, is refused.

SECRET_FILE_MAX_BYTES=4096

# $1: the data folder, $2: the names, space separated. Prints why and returns 1 at the first refused variable.
secret_files_read() {
    secret_file_data="$(readlink -f "$1")" || secret_file_data="$1"
    secret_file_cr="$(printf '\r')"
    secret_file_nl="
"
    for secret_file_name in $2; do
        secret_file_path="$(printenv "${secret_file_name}_FILE")"
        unset "${secret_file_name}_FILE"
        [ -n "$secret_file_path" ] || continue
        if [ -n "$(printenv "$secret_file_name")" ]; then
            echo "$secret_file_name and ${secret_file_name}_FILE are both set: set only one of them."
            return 1
        fi
        case "$secret_file_path" in
            /*) ;;
            *)
                echo "${secret_file_name}_FILE must be an absolute path, such as /run/secrets/<name>."
                return 1
                ;;
        esac
        secret_file_real="$(readlink -f "$secret_file_path")" || secret_file_real="$secret_file_path"
        for secret_file_where in "$secret_file_path" "$secret_file_real"; do
            case "$secret_file_where/" in
                "$1"/* | "$secret_file_data"/*)
                    echo "${secret_file_name}_FILE points to $secret_file_path, which is inside the data folder $1: keep secret files outside it, on their own mount such as /run/secrets."
                    return 1
                    ;;
            esac
        done
        if [ ! -e "$secret_file_path" ]; then
            echo "${secret_file_name}_FILE points to $secret_file_path, which does not exist (or root cannot reach it inside the container)."
            return 1
        fi
        if [ ! -f "$secret_file_path" ]; then
            echo "${secret_file_name}_FILE points to $secret_file_path, which is not a regular file."
            return 1
        fi
        # wc and cat get the file through a redirect after their stderr is silenced, and a failed open is the
        # unreadable case (root has no DAC_OVERRIDE with cap_drop: ALL); test -r cannot tell, busybox says yes for root
        secret_file_unreadable="${secret_file_name}_FILE points to $secret_file_path, which root cannot read: the file must be readable by root inside the container (for example owned by root with mode 600 or 400)."
        if ! secret_file_size="$(wc -c 2> /dev/null < "$secret_file_path")"; then
            echo "$secret_file_unreadable"
            return 1
        fi
        if [ "${secret_file_size##* }" -gt "$SECRET_FILE_MAX_BYTES" ]; then
            echo "${secret_file_name}_FILE points to $secret_file_path, which is larger than $SECRET_FILE_MAX_BYTES bytes."
            return 1
        fi
        if ! secret_file_value="$(cat 2> /dev/null < "$secret_file_path")"; then
            echo "$secret_file_unreadable"
            return 1
        fi
        if [ -z "$secret_file_value" ]; then
            echo "${secret_file_name}_FILE points to $secret_file_path, which is empty."
            return 1
        fi
        case "$secret_file_value" in
            *"$secret_file_nl"* | *"$secret_file_cr"*)
                unset secret_file_value
                echo "${secret_file_name}_FILE points to $secret_file_path, which has a line break or a carriage return inside: the value must be one line (a newline at the end is fine, Windows line ends are not)."
                return 1
                ;;
        esac
        export "$secret_file_name=$secret_file_value"
    done
    unset secret_file_value secret_file_size secret_file_path secret_file_real secret_file_where secret_file_unreadable \
        secret_file_name secret_file_data secret_file_cr secret_file_nl
    return 0
}
