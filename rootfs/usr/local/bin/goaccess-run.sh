#!/usr/bin/env sh
# Starts GoAccess for dinit. When the nginx workers run as the unprivileged npmpro-worker user (start.sh), GoAccess
# stays root (it reads the root-only access log) but runs with the workers' group and umask 0007, so its websocket
# socket /run/goaccess.sock is root:npmpro-worker 770 and the workers can connect to it.
if [ -n "$NPMPRO_NGINX_WORKER_GID" ] && [ "$(id -u)" = "0" ]; then
    umask 0007
    exec su-exec "0:$NPMPRO_NGINX_WORKER_GID" goaccess "$@"
fi
exec goaccess "$@"
