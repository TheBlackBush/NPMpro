#!/usr/bin/env sh

echo "
-------------------------------------
PUID:     $PUID
User ID:  $(id -u)
PGID:     $PGID
Group ID: $(id -g)
-------------------------------------
"

if [ -z "$(find -L /data/tls/certbot/accounts/"$(echo "$ACME_SERVER" | sed "s|^https\?://\([^/]\+\).*$|\1|g")" -type f 2> /dev/null)" ]; then
    if [ "$(echo "$ACME_SERVER" | sed "s|^https\?://\([^/]\+\).*$|\1|g")" = "acme.zerossl.com" ] && [ -z "$ACME_EAB_KID" ] && [ -z "$ACME_EAB_HMAC_KEY" ]; then
        if [ -z "$ACME_EMAIL" ]; then
            echo "ACME_EMAIL is required to use zerossl. Either set it or use a different acme server like letsencrypt (ACME_SERVER: https://acme-v02.api.letsencrypt.org/directory)"
            sleep inf
        fi

        ZS_EAB="$(curl -sSL https://api.zerossl.com/acme/eab-credentials-email --data-urlencode "email=$ACME_EMAIL")"
        ACME_EAB_KID="$(echo "$ZS_EAB" | jq -r .eab_kid)"
        export ACME_EAB_KID
        ACME_EAB_HMAC_KEY="$(echo "$ZS_EAB" | jq -r .eab_hmac_key)"
        export ACME_EAB_HMAC_KEY
    fi
    if [ -z "$ACME_EMAIL" ]; then
        if ! certbot --config /run/npmpro/certbot.ini register --server "$ACME_SERVER" --register-unsafely-without-email; then
            sleep inf
        fi
    elif [ -n "$ACME_EMAIL" ] && [ -z "$ACME_EAB_KID" ] && [ -z "$ACME_EAB_HMAC_KEY" ]; then
        if ! certbot --config /run/npmpro/certbot.ini register --server "$ACME_SERVER" --email "$ACME_EMAIL"; then
            sleep inf
        fi
    elif [ -n "$ACME_EMAIL" ] && [ -n "$ACME_EAB_KID" ] && [ -n "$ACME_EAB_HMAC_KEY" ]; then
        # certbot logs its command line: a log folder of its own, removed afterwards, keeps the EAB key out of the log
        eab_logs="$(mktemp -d)"
        if ! certbot --config /run/npmpro/certbot.ini --logs-dir "$eab_logs" register --server "$ACME_SERVER" --eab-kid "$ACME_EAB_KID" --eab-hmac-key "$ACME_EAB_HMAC_KEY" --email "$ACME_EMAIL"; then
            rm -rf "$eab_logs"
            sleep inf
        fi
        rm -rf "$eab_logs"
    fi
    echo
fi

if [ "$ACME_OCSP_STAPLING" = "true" ]; then
    certbot-ocsp-fetcher.sh -c /data/tls/certbot/live -o /data/tls/certbot/live --no-reload-webserver --force-update || true
    echo
fi
if [ "$CUSTOM_OCSP_STAPLING" = "true" ]; then
    certbot-ocsp-fetcher.sh -c /data/tls/custom -o /data/tls/custom --no-reload-webserver --force-update || true
    echo
fi

if [ ! -s /data/tls/ech/config-ids.json ]; then
    jq -n '{current: [], previous: []}' > /data/tls/ech/config-ids.json
fi

if [ -s /data/tls/ech/cron.sh ]; then
    rm -f /data/tls/ech/*-previous.ech
    jq '{current: [], previous: .current}' /data/tls/ech/config-ids.json > /data/tls/ech/config-ids.json.tmp && mv /data/tls/ech/config-ids.json.tmp /data/tls/ech/config-ids.json

    chmod +x /data/tls/ech/cron.sh
    /data/tls/ech/cron.sh

    : > /data/tls/ech/nginx.conf
    for file in /data/tls/ech/*.ech; do
        [ -s "$file" ] && echo "ssl_ech_file $file;" >> /data/tls/ech/nginx.conf
    done
elif [ -s /data/tls/ech/nginx.conf ]; then
    rm -f /data/tls/ech/*.ech
    jq -n '{current: [], previous: []}' > /data/tls/ech/config-ids.json

    : > /data/tls/ech/nginx.conf
fi


# A full regeneration (REGENERATE_ALL) keeps the previous host configs, so the sites keep working until the backend
# has written the new ones and reloads once. Only when nginx rejects them (an update changed what nginx accepts) they
# are moved aside and nginx starts without them; the backend removes the moved files after the regeneration.
if ! nginx -tq; then
    # The saved nginx settings (Settings > nginx) can be what fails, e.g. after an image update. Try the files written
    # from the environment first (cp -p and writing into the existing files keep owner and mode), else put them back.
    core_backup="$(mktemp -d)"
    for core_name in main events http stream; do
        cp -p "/data/npmpro/nginx/core-$core_name.conf" "$core_backup/" 2> /dev/null || true
    done
    if nginx-core-files.sh /data/npmpro/nginx && nginx -tq; then
        echo "The saved nginx settings did not pass nginx -t, the nginx settings files were rewritten from the environment."
    else
        for core_name in main events http stream; do
            [ -f "$core_backup/core-$core_name.conf" ] && cp -p "$core_backup/core-$core_name.conf" /data/npmpro/nginx/
        done
    fi
    rm -rf "$core_backup"
fi
if ! nginx -tq; then
    if [ "$REGENERATE_ALL" = "true" ]; then
        echo "The previous host configs do not pass nginx -t, starting without them until they are regenerated."
        find /data/nginx -mindepth 2 -maxdepth 2 -name "*.conf" -exec mv {} {}.stale \;
    fi
    if ! nginx -tq; then
        sleep inf
    fi
fi
if [ "$PHP83" = "true" ]; then
    if ! PHP_INI_SCAN_DIR=/data/php/83/conf.d php-fpm83 -c /data/php/83 -y /data/php/83/php-fpm.conf -FOt > /dev/null 2>&1; then
        PHP_INI_SCAN_DIR=/data/php/83/conf.d php-fpm83 -c /data/php/83 -y /data/php/83/php-fpm.conf -FOt
        sleep inf
    fi
fi
if [ "$PHP84" = "true" ]; then
    if ! PHP_INI_SCAN_DIR=/data/php/84/conf.d php-fpm84 -c /data/php/84 -y /data/php/84/php-fpm.conf -FOt > /dev/null 2>&1; then
        PHP_INI_SCAN_DIR=/data/php/84/conf.d php-fpm84 -c /data/php/84 -y /data/php/84/php-fpm.conf -FOt
        sleep inf
    fi
fi
if [ "$PHP85" = "true" ]; then
    if ! PHP_INI_SCAN_DIR=/data/php/85/conf.d php-fpm85 -c /data/php/85 -y /data/php/85/php-fpm.conf -FOt > /dev/null 2>&1; then
        PHP_INI_SCAN_DIR=/data/php/85/conf.d php-fpm85 -c /data/php/85 -y /data/php/85/php-fpm.conf -FOt
        sleep inf
    fi
fi


echo "0 */$ECH_ROTATION_INTERVAL * * * cron-ech.sh" | tee "/tmp/crontabs/$(id -un)"
# always installed: the access log can be switched on at runtime (traffic statistics), missingok/notifempty skip absent or empty logs
logrotate --state /data/nginx/logs/logrotate.state /run/npmpro/logrotate
echo "0 * * * * logrotate --state /data/nginx/logs/logrotate.state /run/npmpro/logrotate" | tee -a "/tmp/crontabs/$(id -un)"

set -- backend nginx crond
[ "$GOA" = "true" ] && set -- "$@" goaccess
[ "$PHP83" = "true" ] && set -- "$@" php-fpm83
[ "$PHP84" = "true" ] && set -- "$@" php-fpm84
[ "$PHP85" = "true" ] && set -- "$@" php-fpm85

echo "Starting services..."
exec dinit -s "$@"
