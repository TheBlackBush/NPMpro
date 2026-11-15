#!/usr/bin/env sh
# Starts GoAccess for dinit. When the nginx workers run as the unprivileged npmpro-worker user (start.sh), GoAccess
# stays root (it reads the root-only access log) but runs with the workers' group and umask 0007, so its websocket
# socket /run/goaccess.sock is root:npmpro-worker 770 and the workers can connect to it.
# the format nginx writes (Settings, Logs & monitoring, Log format), read at the start: GoAccess keeps it until it
# restarts, lines of the other format count as failed requests in its report
if grep -qs " ajson;" /data/npmpro/nginx/access-log.conf; then
    format='{"time_local":"%d:%t %^","host":"%v","remote_addr":"%h","request_time":"%T","request":"%r","status":"%s","bytes_sent":"%b","http_referer":"%R","http_user_agent":"%u","remote_user":"%e","sent_http_content_type":"%M","ssl_protocol":"%K","ssl_cipher":"%k","upstream_cache_status":"%C"}'
else
    format='[%d:%t %^] %v %h %T "%r" %s %b "%R" "%u" "%e" "%M" %K %k %g %C'
fi
set -- --log-format="$format" "$@"
if [ -n "$NPMPRO_NGINX_WORKER_GID" ] && [ "$(id -u)" = "0" ]; then
    umask 0007
    exec su-exec "0:$NPMPRO_NGINX_WORKER_GID" goaccess "$@"
fi
exec goaccess "$@"
