#!/usr/bin/env sh
# A fatal setting prints the reason and sleeps (sleep inf) instead of exiting:
# a restart loop would repeat ACME requests and flood the log.

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


# The CrowdSec bouncer reads crowdsec.conf and parses its TLS client certificate and key when nginx starts, which
# nginx -t does not do: a missing crowdsec.conf or a TLS client file it cannot parse stops nginx and with it the whole
# container. The bouncer stays off until the file is fixed (the settings in the database stay as they are, the backend
# writes the include again from them at the next start). A missing ban or captcha page does not stop the bouncer (it
# logs it and answers with the status code), so the pages are not checked here.
# crowdsec-files-check begin
if grep -qxF "include /usr/local/nginx/conf/crowdsec-bouncer.conf;" /data/npmpro/nginx/crowdsec.conf 2> /dev/null; then
    # the same reading as the backend's parseConfLines: key in any case, an optional "export ", one pair of quotes, an
    # unquoted " #" tail removed, the last line of a key wins. The bouncer's own reader is simpler; it differs only on a
    # hand-edited file at the first start (afterwards the backend writes a file both read the same), so this follows
    # the backend's parser, not the bouncer's.
    crowdsec_value() {
        tr -d '\r' < /data/crowdsec/crowdsec.conf 2> /dev/null | awk -v key="$1" '
            {
                line = $0
                sub(/^[ \t]*(export[ \t]+)?/, "", line)
                eq = index(line, "=")
                if (eq < 2) next
                name = substr(line, 1, eq - 1)
                gsub(/[ \t]/, "", name)
                if (toupper(name) != key) next
                val = substr(line, eq + 1)
                sub(/^[ \t]+/, "", val)
                quote = substr(val, 1, 1)
                if (quote == "\"" || quote == "\047") {
                    end = index(substr(val, 2), quote)
                    if (end > 0) {
                        found = substr(val, 2, end - 1)
                        next
                    }
                } else {
                    sub(/[ \t]+#.*$/, "", val)
                }
                sub(/[ \t]+$/, "", val)
                found = val
            }
            END { print found }
        '
    }
    crowdsec_unusable=""
    if [ ! -f /data/crowdsec/crowdsec.conf ] || [ ! -r /data/crowdsec/crowdsec.conf ]; then
        crowdsec_unusable=/data/crowdsec/crowdsec.conf
    elif [ "$(crowdsec_value USE_TLS_AUTH | tr '[:upper:]' '[:lower:]')" = "true" ]; then
        # the bouncer takes PEM only, and has no passphrase for an encrypted key
        crowdsec_cert="$(crowdsec_value TLS_CLIENT_CERT)"
        crowdsec_key="$(crowdsec_value TLS_CLIENT_KEY)"
        if [ -z "$crowdsec_cert" ]; then
            crowdsec_unusable=TLS_CLIENT_CERT
        elif ! openssl x509 -inform PEM -noout -in "$crowdsec_cert" < /dev/null > /dev/null 2>&1; then
            crowdsec_unusable="$crowdsec_cert"
        elif [ -z "$crowdsec_key" ]; then
            crowdsec_unusable=TLS_CLIENT_KEY
        elif ! openssl pkey -inform PEM -passin pass: -noout -in "$crowdsec_key" < /dev/null > /dev/null 2>&1; then
            crowdsec_unusable="$crowdsec_key"
        fi
    fi
    if [ -n "$crowdsec_unusable" ]; then
        echo "# the CrowdSec bouncer is off (Settings, CrowdSec)" > /data/npmpro/nginx/crowdsec.conf
        echo "CrowdSec: $crowdsec_unusable is not set, missing, unreadable or not valid PEM, the bouncer stays off until it is fixed (Settings, CrowdSec)"
    fi
fi
# crowdsec-files-check end

# A full regeneration (REGENERATE_ALL) keeps the previous host configs, so the sites keep working until the backend
# has written the new ones and reloads once. Only when nginx rejects them (an update changed what nginx accepts) they
# are moved aside and nginx starts without them; the backend removes the moved files after the regeneration.
if ! nginx -tq; then
    # A CrowdSec bouncer config nginx rejects must not keep nginx from starting: the bouncer is off until the backend
    # writes it again from Settings, CrowdSec. nginx -t does not run the bouncer's init, so this only catches a
    # directive conflict (for example a custom include that also declares lua_shared_dict crowdsec_cache); the files
    # the bouncer opens at init are checked above.
    crowdsec_off=false
    if grep -q "^include" /data/npmpro/nginx/crowdsec.conf 2> /dev/null; then
        echo "# the CrowdSec bouncer is off (Settings, CrowdSec)" > /data/npmpro/nginx/crowdsec.conf
        if nginx -tq; then
            crowdsec_off=true
            echo "The CrowdSec bouncer did not pass nginx -t and is off until its settings pass (Settings, CrowdSec)."
        else
            echo "include /usr/local/nginx/conf/crowdsec-bouncer.conf;" > /data/npmpro/nginx/crowdsec.conf
        fi
    fi
    if [ "$crowdsec_off" = false ]; then
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
for v in 83 84 85; do
    [ "$(printenv "PHP$v")" = "true" ] || continue
    if ! PHP_INI_SCAN_DIR="/data/php/$v/conf.d" "php-fpm$v" -c "/data/php/$v" -y "/data/php/$v/php-fpm.conf" -FOt > /dev/null 2>&1; then
        PHP_INI_SCAN_DIR="/data/php/$v/conf.d" "php-fpm$v" -c "/data/php/$v" -y "/data/php/$v/php-fpm.conf" -FOt
        sleep inf
    fi
done


echo "0 */$ECH_ROTATION_INTERVAL * * * cron-ech.sh" | tee "/tmp/crontabs/$(id -un)"
# always installed: the access log can be switched on at runtime (traffic statistics); missingok/notifempty skip
# absent or empty logs
logrotate --state /data/nginx/logs/logrotate.state /run/npmpro/logrotate
echo "0 * * * * logrotate --state /data/nginx/logs/logrotate.state /run/npmpro/logrotate" | tee -a "/tmp/crontabs/$(id -un)"

set -- backend nginx crond
[ "$GOA" = "true" ] && set -- "$@" goaccess
for v in 83 84 85; do
    [ "$(printenv "PHP$v")" = "true" ] && set -- "$@" "php-fpm$v"
done

echo "Starting services..."
exec dinit -s "$@"
