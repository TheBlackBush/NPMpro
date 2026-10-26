#!/usr/bin/env sh
# Runs as root. With PUID set, root never runs, sources, chowns or writes through anything the PUID user can change:
# image code stays root-owned, the few runtime folders are recreated before they are handed over (without
# recursion), and the /data housekeeping (data-setup.sh) runs as the PUID user.

umask 022

if [ "$PUID" != "0" ]; then
    if [ -n "$(getent group "$PGID" 2>/dev/null)" ]; then
        :
    elif [ -n "$(getent group npmpro 2>/dev/null)" ]; then
        groupmod -g "$PGID" npmpro
    else
        groupadd -g "$PGID" npmpro
    fi

    if [ -n "$(getent passwd "$PUID" 2>/dev/null)" ]; then
        :
    elif [ -n "$(getent passwd npmpro 2>/dev/null)" ]; then
        usermod -u "$PUID" -g "$PGID" -G "" -d /tmp npmpro
    else
        useradd -u "$PUID" -g "$PGID" -M -d /tmp -s /sbin/nologin npmpro
    fi
fi

# runtime folders, recreated on every start so nothing a PUID process left there survives; root writes only into the
# fresh /run/npmpro before it is handed over
# nscd: musl asks /run/nscd/socket for users and groups missing from /etc/passwd and /etc/group
rm -rf /run/npmpro /run/nginx /run/dinitctl /run/nscd /var/run/nscd
find /run -maxdepth 1 -type s -delete
mkdir -p /run/npmpro /run/nginx
rm -rf /tmp/npmhome /tmp/goa /tmp/crontabs /tmp/certbot-log /tmp/certbot-work /tmp/certbot-credentials /tmp/certbot-python /tmp/nginx /tmp/env.sha512sum
mkdir -p /tmp/npmhome /tmp/goa /tmp/crontabs /tmp/certbot-log /tmp/certbot-work /tmp/certbot-credentials /tmp/certbot-python /tmp/nginx
# nginx opens its compiled-in error log (logs/error.log) before it reads nginx.conf
rm -rf /usr/local/nginx/logs /usr/local/nginx/client_body_temp /usr/local/nginx/proxy_temp /usr/local/nginx/fastcgi_temp /usr/local/nginx/uwsgi_temp /usr/local/nginx/scgi_temp
mkdir -p /usr/local/nginx/logs

# the live certbot config, written again by the backend when the certificate settings change (PUID can not write /etc)
cp /etc/certbot.ini /run/npmpro/certbot.ini
if [ "$ACME_KEY_TYPE" = "rsa" ]; then
    sed -i "s|key-type = ecdsa|key-type = rsa|g" /run/npmpro/certbot.ini
    if [ "$ACME_KEY_SIZE" != "4096" ]; then
        sed -i "s|rsa-key-size = .*|rsa-key-size = $ACME_KEY_SIZE|g" /run/npmpro/certbot.ini
    fi
else
    if [ "$ACME_KEY_SIZE" != "secp384r1" ]; then
        sed -i "s|elliptic-curve = .*|elliptic-curve = $ACME_KEY_SIZE|g" /run/npmpro/certbot.ini
    fi
fi
if [ "$ACME_MUST_STAPLE" = "false" ]; then
    sed -i "s|must-staple = true|must-staple = false|g" /run/npmpro/certbot.ini
fi
if [ "$ACME_SERVER_TLS_VERIFY" = "false" ]; then
    sed -i "s|no-verify-ssl = false|no-verify-ssl = true|g" /run/npmpro/certbot.ini
fi
if [ "$ACME_PROFILE" != "none" ]; then
    sed -i "s|#required-profile|required-profile = $ACME_PROFILE|g" /run/npmpro/certbot.ini
fi

# the live logrotate config, written again by the backend when the log rotations setting changes
cp /etc/logrotate /run/npmpro/logrotate
sed -i "s|rotate [0-9]\+|rotate $LOGROTATIONS|g" /run/npmpro/logrotate


if [ "$PHP83" = "true" ]; then
    apk add --no-cache php83-fpm
    # From https://github.com/nextcloud/all-in-one/pull/1377/files
    if [ -n "$PHP83_APKS" ]; then
        for apk in $(echo "$PHP83_APKS" | tr " " "\n"); do
            if ! echo "$apk" | grep -q "^php83-.*$"; then
                echo "$apk is a non allowed value."
                echo "It needs to start with \"php83-\"."
                echo "It is set to \"$apk\"."
                sleep inf
            fi
            echo "Installing $apk via apk..."
            if ! apk add --no-cache "$apk" > /dev/null 2>&1; then
                echo "The apk \"$apk\" was not installed!"
            fi
        done
    fi
fi

if [ "$PHP84" = "true" ]; then
    apk add --no-cache php84-fpm
    # From https://github.com/nextcloud/all-in-one/pull/1377/files
    if [ -n "$PHP84_APKS" ]; then
        for apk in $(echo "$PHP84_APKS" | tr " " "\n"); do
            if ! echo "$apk" | grep -q "^php84-.*$"; then
                echo "$apk is a non allowed value."
                echo "It needs to start with \"php84-\"."
                echo "It is set to \"$apk\"."
                sleep inf
            fi
            echo "Installing $apk via apk..."
            if ! apk add --no-cache "$apk" > /dev/null 2>&1; then
                echo "The apk \"$apk\" was not installed!"
            fi
        done
    fi
fi

if [ "$PHP85" = "true" ]; then
    apk add --no-cache php85-fpm
    # From https://github.com/nextcloud/all-in-one/pull/1377/files
    if [ -n "$PHP85_APKS" ]; then
        for apk in $(echo "$PHP85_APKS" | tr " " "\n"); do
            if ! echo "$apk" | grep -q "^php85-.*$"; then
                echo "$apk is a non allowed value."
                echo "It needs to start with \"php85-\"."
                echo "It is set to \"$apk\"."
                sleep inf
            fi
            echo "Installing $apk via apk..."
            if ! apk add --no-cache "$apk" > /dev/null 2>&1; then
                echo "The apk \"$apk\" was not installed!"
            fi
        done
    fi
fi

if { [ "$PHP83" = "true" ] || [ "$PHP84" = "true" ] || [ "$PHP85" = "true" ]; } && [ -n "$PHP_APKS" ]; then
    # From https://github.com/nextcloud/all-in-one/pull/1377/files
    for apk in $(echo "$PHP_APKS" | tr " " "\n"); do
        if ! echo "$apk" | grep -q "^php-.*$"; then
            echo "$apk is a non allowed value."
            echo "It needs to start with \"php-\"."
            echo "It is set to \"$apk\"."
            sleep inf
        fi
        echo "Installing $apk via apk..."
        if ! apk add --no-cache "$apk" > /dev/null 2>&1; then
            echo "The apk \"$apk\" was not installed!"
        fi
    done
fi


# conf.d: start.sh edits it as root and the backend (as PUID) writes default.conf and ip_ranges.conf into it. Only
# single-link regular files are kept, and they go back to root for the edits.
find /usr/local/nginx/conf/conf.d -mindepth 1 \( ! -type f -o -links +1 \) -exec rm -rf {} +
chown -R 0:0 /usr/local/nginx/conf/conf.d

# As root, the nginx workers run as npmpro-worker (uid/gid 101) when the container has the capabilities for it:
# SETUID and SETGID (start the workers as another user) and CHOWN (give them read access). Without them the workers
# stay root, as before, and the log says what to add.
if [ "$PUID" = "0" ]; then
    capeff="$(awk '/^CapEff:/ {print $2}' /proc/self/status)"
    if [ $((0x$capeff & 0xC1)) -eq $((0xC1)) ]; then
        export NPMPRO_NGINX_WORKER_GID=101
    else
        echo "The nginx workers run as root: add the SETUID and CHOWN capabilities (cap_add in compose.yaml) to run them as the unprivileged npmpro-worker user."
    fi
fi

# /data itself stays root's (so the PUID user can not remove or swap .env or prerun); its top-level folders are
# created here and the old top-level leftovers are removed after data-setup.sh
chown 0:0 /data
chmod 755 /data
mkdir -p /data/npmpro /data/tls /data/acme-challenge /data/avatar /data/gravatar /data/html /data/access /data/anubis /data/crowdsec /data/nginx /data/custom_nginx /data/php /data/goaccess

if [ "$PUID" != "0" ]; then
    # /data is its own filesystem; .env and prerun stay root's, and files with more than one link are skipped so a
    # hardlink can not hand over a root file. The runtime folders get only their own owner, never their contents.
    find /data -mindepth 1 \( -path /data/.env -o -path /data/prerun \) -prune -o \( -type d -o -links 1 \) \
         -not \( -uid "$PUID" -and -gid "$PGID" \) \
         -print0 \
         | xargs -r0 -P "$(($(nproc)*4))" -n 100 chown -h "$PUID:$PGID"
    chown "$PUID:$PGID" /run /run/npmpro /run/nginx /run/npmpro/certbot.ini /run/npmpro/logrotate \
          /tmp/npmhome /tmp/goa /tmp/crontabs /tmp/certbot-log /tmp/certbot-work /tmp/certbot-credentials /tmp/certbot-python /tmp/nginx \
          /usr/local/nginx/logs
    chown "$PUID:$PGID" /proc/self/fd/2
    su-exec "$PUID:$PGID" data-setup.sh
else
    find /data -not \( -uid 0 -and -gid 0 \) -print0 | xargs -r0 -P "$(($(nproc)*4))" -n 100 chown -h 0:0
    data-setup.sh
fi

# top-level leftovers of old versions, copied by data-setup.sh (rm does not follow links)
rm -rf /data/nginx_custom /data/etc /data/npm /data/custom_ssl /data/letsencrypt-acme-challenge /data/logs /data/keys.json
if [ -f /data/database.sqlite ] && [ -s /data/npmpro/database.sqlite ] && cmp -s /data/database.sqlite /data/npmpro/database.sqlite; then
    rm -f /data/database.sqlite
fi
if [ -f /data/logrotate.state ] && [ -e /data/nginx/logs/logrotate.state ]; then
    rm -f /data/logrotate.state
fi


if [ -f /data/crowdsec/crowdsec.conf ] && [ ! -L /data/crowdsec/crowdsec.conf ] && grep -iq "^ENABLED *= *true$" /data/crowdsec/crowdsec.conf; then
    if [ ! -s /usr/local/nginx/conf/conf.d/crowdsec.conf ]; then
        cp -van /usr/local/nginx/conf/conf.d/crowdsec.conf.disabled /usr/local/nginx/conf/conf.d/crowdsec.conf
    fi
else
    rm -vf /usr/local/nginx/conf/conf.d/crowdsec.conf
fi

sed -i "s|#\?listen 0.0.0.0:81 |listen $NPM_IPV4_BINDING:$NPM_PORT |g" /usr/local/nginx/conf/conf.d/npmpro.conf

if [ "$DISABLE_IPV6" = "true" ]; then
    sed -i "s|ipv6=on;|ipv6=off;|g" /usr/local/nginx/conf/nginx.conf
    sed -i "s|#\?listen \[::\]:81 |#listen $NPM_IPV6_BINDING:$NPM_PORT |g" /usr/local/nginx/conf/conf.d/npmpro.conf
else
    sed -i "s|#\?listen \[::\]:81 |listen $NPM_IPV6_BINDING:$NPM_PORT |g" /usr/local/nginx/conf/conf.d/npmpro.conf
fi

if [ "$ENABLE_MPTCP" = "false" ]; then
    sed -i "s| multipath||g" /usr/local/nginx/conf/conf.d/npmpro.conf
fi

if [ "$LISTEN_PROXY_PROTOCOL_HTTP" = "true" ] || [ "$LISTEN_PROXY_PROTOCOL_HTTPS" = "true" ]; then
  sed -i "s|real_ip_header.*|real_ip_header proxy_protocol;|g" /usr/local/nginx/conf/nginx.conf
fi
if [ "$NGINX_QUIC_BPF" = "true" ]; then
  sed -i "s|quic_bpf.*|quic_bpf on;|g" /usr/local/nginx/conf/nginx.conf
fi
if [ "$NGINX_LOG_NOT_FOUND" = "true" ]; then
    sed -i "s|log_not_found.*|log_not_found on;|g" /usr/local/nginx/conf/nginx.conf
fi
if [ "$NGINX_WORKER_PROCESSES" != "auto" ]; then
    sed -i "s|worker_processes.*|worker_processes $NGINX_WORKER_PROCESSES;|g" /usr/local/nginx/conf/nginx.conf
fi
if [ "$NGINX_FORCE_X25519MLKEM768" = "true" ]; then
    sed -i "s|X25519MLKEM768:x25519:secp521r1:secp384r1:prime256v1;|X25519MLKEM768;|g" /usr/local/nginx/conf/nginx.conf
fi
if [ "$NGINX_WORKER_SHUTDOWN_TIMEOUT" != "0" ]; then
    sed -i "s|#worker_shutdown_timeout;|worker_shutdown_timeout $NGINX_WORKER_SHUTDOWN_TIMEOUT;|g" /usr/local/nginx/conf/nginx.conf
fi
if [ "$NGINX_WORKER_CONNECTIONS" != "512" ]; then
    sed -i "s|#worker_connections;|worker_connections $NGINX_WORKER_CONNECTIONS;|g" /usr/local/nginx/conf/nginx.conf
fi
if [ "$NGINX_DISABLE_TLS12" = "true" ]; then
    sed -i "s|ssl_protocols TLSv1.2|ssl_protocols|g" /usr/local/nginx/conf/nginx.conf
fi
if [ "$NGINX_TRUST_SECPR1" = "false" ]; then
    sed -i "s|X25519MLKEM768:x25519:secp521r1:secp384r1:prime256v1;|X25519MLKEM768:x25519;|g" /usr/local/nginx/conf/nginx.conf
fi
if [ "$NGINX_TRUST_RSA_PKCS1" = "true" ]; then
    sed -i "s|mldsa87:mldsa65:mldsa44:ed25519:ecdsa_secp521r1_sha512:ecdsa_secp384r1_sha384:ecdsa_secp256r1_sha256:rsa_pss_rsae_sha512:rsa_pss_rsae_sha384:rsa_pss_rsae_sha256;|mldsa87:mldsa65:mldsa44:ed25519:ecdsa_secp521r1_sha512:ecdsa_secp384r1_sha384:ecdsa_secp256r1_sha256:rsa_pss_rsae_sha512:rsa_pss_rsae_sha384:rsa_pss_rsae_sha256:rsa_pkcs1_sha512:rsa_pkcs1_sha384:rsa_pkcs1_sha256;|g" /usr/local/nginx/conf/nginx.conf
fi

if [ "$NGINX_LOAD_NJS_MODULE" = "true" ]; then
    sed -i "s|#\(load_module.\+js_module.so;\)|\1|g" /usr/local/nginx/conf/nginx.conf
    sed -i "s|#js_engine qjs;|js_engine qjs;|g" /usr/local/nginx/conf/nginx.conf
fi
if [ "$NGINX_LOAD_LDAP_MODULE" = "true" ]; then
    sed -i "s|#\(load_module.\+ngx_http_auth_ldap_module.so;\)|\1|g" /usr/local/nginx/conf/nginx.conf
fi
if [ "$NGINX_LOAD_NTLM_MODULE" = "true" ]; then
    sed -i "s|#\(load_module.\+ngx_http_upstream_ntlm_module.so;\)|\1|g" /usr/local/nginx/conf/nginx.conf
fi
if [ "$NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE" = "true" ]; then
    sed -i "s|#\(load_module.\+ngx_http_vhost_traffic_status_module.so;\)|\1|g" /usr/local/nginx/conf/nginx.conf
fi

if [ "$PUID" != "0" ]; then
    chown "$PUID:$PGID" /usr/local/nginx/conf/conf.d
    find /usr/local/nginx/conf/conf.d -mindepth 1 -maxdepth 1 -type f -links 1 -exec chown "$PUID:$PGID" {} +

    # certbot DNS plugins: the image's Python (/usr/local) is root's, so pip installs them for the PUID user into a
    # folder recreated on every start; only the PUID user ever runs certbot
    export PIP_USER=1 PYTHONUSERBASE=/tmp/certbot-python
    exec su-exec "$PUID:$PGID" launch.sh
else
    # The internet-facing workers run as npmpro-worker (uid/gid 101), the master stays root: it reads the TLS keys,
    # the configs and opens the logs before the workers start. The workers only get what they serve or check per
    # request; the database, keys, credentials and TLS private keys stay root-only (700/600).
    if [ -n "$NPMPRO_NGINX_WORKER_GID" ]; then
        sed -i "s|^#user;|user npmpro-worker npmpro-worker;|" /usr/local/nginx/conf/nginx.conf
        # nginx's temp folders, made here: root has no DAC_OVERRIDE, so it can not create them in a folder it gave away
        mkdir -p /tmp/nginx/client_body /tmp/nginx/proxy /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi
        chown 101:101 /tmp/nginx /tmp/nginx/client_body /tmp/nginx/proxy /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi
        # ACME http challenges, htpasswd files and avatars; the workers get nothing in /data/tls or /data/npmpro
        for dir in /data/acme-challenge /data/access /data/avatar /data/gravatar; do
            [ -d "$dir" ] || continue
            find "$dir" \( -type d -o -type f \) -links 1 -exec chgrp -h 101 {} +
            find "$dir" -type d -exec chmod 750 {} +
            find "$dir" -type f -links 1 -exec chmod 640 {} +
        done
    fi
    exec launch.sh
fi
