#!/usr/bin/env sh
# Writes the log includes nginx.conf reads (access-log.conf, error-log.conf, stream-log.conf) into $1 from LOGROTATE,
# TRAFFIC_STATS and CrowdSec (CROWDSEC_ENABLED, else ENABLED in the crowdsec.conf $2 the backend writes): CrowdSec
# reads the log files, so it keeps them on like Write log files. The same lines as backend/lib/log-files.js and
# backend/lib/traffic/access-log.js (backend/test/log-includes.test.js compares them); the backend rewrites them at
# start and on every save.
set -eu
dir="$1"
crowdsec_conf="$2"

crowdsec=false
case "$(printf "%s" "${CROWDSEC_ENABLED:-}" | tr -d " \t" | tr "[:upper:]" "[:lower:]")" in
    true) crowdsec=true ;;
    false) ;;
    *)
        if [ -f "$crowdsec_conf" ] && [ ! -L "$crowdsec_conf" ] && tr -d '\r' < "$crowdsec_conf" | grep -iq "^ENABLED *= *true *$"; then
            crowdsec=true
        fi
        ;;
esac

files=false
if [ "${LOGROTATE:-}" = "true" ] || [ "$crowdsec" = "true" ]; then files=true; fi

if [ "$files" = "true" ] || [ "${TRAFFIC_STATS:-}" = "true" ]; then
    echo "access_log /data/nginx/logs/access.log alog;" > "$dir/access-log.conf"
else
    echo "access_log off;" > "$dir/access-log.conf"
fi
if [ "$files" = "true" ]; then
    echo "error_log /data/nginx/logs/error.log warn;" > "$dir/error-log.conf"
    echo "access_log /data/nginx/logs/stream.log slog;" > "$dir/stream-log.conf"
else
    echo "# no error log file, errors go to stderr" > "$dir/error-log.conf"
    echo "access_log off;" > "$dir/stream-log.conf"
fi
