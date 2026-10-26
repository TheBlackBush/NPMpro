#!/usr/bin/env sh
# The /data housekeeping of a start, run by start.sh as the PUID user when PUID is set (as root otherwise), so root
# never creates, copies or writes through files the PUID user can replace.

umask 022

if [ "$ACME_PROFILE" = "none" ]; then
    find /data/tls/certbot/renewal -type f -name '*.conf' -exec sed -i "/required_profile/d" {} \;
fi

php_setup() {
    mkdir -vp /data/php
    cp -varnT /etc/php"$1" /data/php/"$1"
    sed -i "s|#\?listen =.*|listen = /run/php$1.sock|" /data/php/"$1"/php-fpm.d/www.conf
    sed -i "s|;error_log =.*|error_log = /proc/self/fd/2|g" /data/php/"$1"/php-fpm.conf
    sed -i "s|include=.*|include=/data/php/$1/php-fpm.d/*.conf|g" /data/php/"$1"/php-fpm.conf
    if [ "$PUID" != "0" ]; then
        # the pool runs as the user that starts php-fpm (the PUID user)
        sed -i "s|;\?user =.*|;user = root|" /data/php/"$1"/php-fpm.d/www.conf
        sed -i "s|;\?group =.*|;group = root|" /data/php/"$1"/php-fpm.d/www.conf
    else
        # started as root, the pool runs as nobody (also when the file was set up for PUID before)
        sed -i "s|;\?user =.*|user = nobody|" /data/php/"$1"/php-fpm.d/www.conf
        sed -i "s|;\?group =.*|group = nobody|" /data/php/"$1"/php-fpm.d/www.conf
    fi
}
if [ "$PHP83" = "true" ]; then php_setup 83; fi
if [ "$PHP84" = "true" ]; then php_setup 84; fi
if [ "$PHP85" = "true" ]; then php_setup 85; fi

mkdir -vp /data/npmpro/avatar \
          /data/npmpro/gravatar \
          /data/tls/certbot/renewal \
          /data/tls/certbot/acme-challenge/.well-known/acme-challenge \
          /data/tls/custom \
          /data/tls/mtls \
          /data/tls/ech \
          /data/html \
          /data/access \
          /data/anubis \
          /data/crowdsec \
          /data/nginx/redirection_host \
          /data/nginx/proxy_host \
          /data/nginx/dead_host \
          /data/nginx/stream \
          /data/nginx/logs \
          /data/custom_nginx


if [ -n "$(ls -A /data/nginx/custom 2> /dev/null)"  ]; then
    cp -van /data/nginx/custom/* /data/custom_nginx
fi
rm -vrf /data/nginx/custom

#tmp
if [ -n "$(ls -A /data/nginx_custom 2> /dev/null)"  ]; then
    cp -van /data/nginx_custom/* /data/custom_nginx
fi

#tmp
if [ -n "$(ls -A /data/etc 2> /dev/null)" ]; then
    cp -van /data/etc/* /data
    if [ -s /data/crowdsec/crowdsec.conf ]; then
        sed -i "s|/data/etc|/data|g" /data/crowdsec/crowdsec.conf
    fi
fi

#tmp
if [ -n "$(ls -A /data/npm 2> /dev/null)" ]; then
    cp -van /data/npm/* /data/npmpro
fi

#tmp
# copied, not moved: /data itself is root's, start.sh removes the old file afterwards
if [ -s /data/database.sqlite ] && [ ! -e /data/npmpro/database.sqlite ]; then
    cp -va /data/database.sqlite /data/npmpro/database.sqlite
fi


if [ -n "$(ls -A /data/nginx/default_www 2> /dev/null)" ]; then
    cp -van /data/nginx/default_www/* /data/html
fi
rm -vrf /data/nginx/default_www

if [ -n "$(ls -A /data/custom_ssl 2> /dev/null)" ]; then
    cp -van /data/custom_ssl/* /data/tls/custom
fi

for dir in /data/tls/custom/npm-*; do
    if [ -s "$dir/fullchain.pem" ] && { [ ! -s "$dir/cert.pem" ] || [ ! -s "$dir/chain.pem" ]; } then
        awk '/-----BEGIN CERTIFICATE-----/ { n++ } n == 1' "$dir/fullchain.pem" > "$dir/cert.pem"
        awk '/-----BEGIN CERTIFICATE-----/ { n++ } n > 1' "$dir/fullchain.pem" > "$dir/chain.pem"
    fi
done


if mountpoint -q /etc/letsencrypt; then
  if [ -n "$(ls -A /etc/letsencrypt 2> /dev/null)" ]; then
    cp -van /etc/letsencrypt/* /data/tls/certbot
  fi
  echo "All certbot certs have been copied, please remove the /etc/letsencrypt mountpoint and redeploy to continue the migration!"
  sleep inf
fi

#tmp move to mointpoint if block
find /data/tls/certbot/renewal -type f -name '*.conf' -exec sed -i "s|/etc/letsencrypt|/data/tls/certbot|g" {} \;
find /data/tls/certbot/renewal -type f -name '*.conf' -exec sed -i "s|/data/tls/certbot/credentials|/tmp/certbot-credentials|g" {} \;
# the old plaintext credential files, once no renewal config points to them (the line above moved them all)
if [ -d /data/tls/certbot/credentials ] && ! grep -rqs /data/tls/certbot/credentials /data/tls/certbot/renewal; then
    rm -rvf /data/tls/certbot/credentials
fi
# copies of the database from before an upgrade still hold what it held then (plaintext DNS credentials of NPMplus)
for old_data in /data/npmplus.backup-*; do
    [ -d "$old_data" ] && echo "Note: $old_data is the data folder from before the NPMplus upgrade and holds its secrets in plaintext (DNS credentials, signing key). Delete it once NPMpro works for you."
done

if [ -d /data/tls/certbot/live ] && [ -d /data/tls/certbot/archive ]; then
  certs="$(mktemp)"
  find /data/tls/certbot/live ! -name "$(printf "*\n*")" -type f -name "*.pem" > "$certs"
  while IFS= read -r cert
  do
    ln -rsf "$(find /data/tls/certbot/archive/"$(echo "$cert" | sed "s|/data/tls/certbot/live/\(npm-[0-9]\+/.*\).pem|\1|g")"*.pem | sort -V | tail -n1)" "$cert"
  done < "$certs"
  rm -f "$certs"
fi

rm -vrf /data/tls/certbot/crs
rm -vrf /data/tls/certbot/keys
if [ -d /data/tls/certbot/live ] && [ -d /data/tls/certbot/archive ]; then
    certs_in_use="$(find /data/tls/certbot/live -type l -name "*.pem" -exec readlink -f {} \;)"
    archives="$(mktemp)"
    find /data/tls/certbot/archive ! -name "$(printf "*\n*")" -type f -name "*.pem" > "$archives"
    while IFS= read -r archive
    do
        if ! echo "$certs_in_use" | grep -q "$archive"; then
          rm -vf "$archive"
        fi
    done < "$archives"
    rm -f "$archives"
fi

# can be used to delete certificates which expired more than 16 weeks ago
#for cert in $(find /data/tls/certbot/live/npm-* -type d | sed "s|/data/tls/certbot/live/||g"); do
#    if ! openssl x509 -in "/data/tls/certbot/live/$cert/fullchain.pem" -checkend -9676800 >/dev/null; then
#        rm -rvf "/data/tls/certbot/live/$cert"
#        rm -rvf "/data/tls/certbot/live/$cert.der"
#        rm -rvf "/data/tls/certbot/archive/$cert"
#        rm -rvf "/data/tls/certbot/renewal/$cert.conf"
#    fi
#done

rm -vrf /data/nginx/default_host \
        /data/nginx/temp \
        /data/npmpro/keys.json

touch /data/tls/ech/nginx.conf \
      /data/tls/ech/cron.sh \
      /data/html/index.html \
      /data/anubis/happy.webp \
      /data/anubis/reject.webp \
      /data/anubis/pensive.webp \
      /data/custom_nginx/events.conf \
      /data/custom_nginx/http.conf \
      /data/custom_nginx/http_top.conf \
      /data/custom_nginx/root_top.conf \
      /data/custom_nginx/root.conf \
      /data/custom_nginx/server_http.conf \
      /data/custom_nginx/server_dead.conf \
      /data/custom_nginx/server_proxy.conf \
      /data/custom_nginx/server_redirect.conf \
      /data/custom_nginx/stream.conf \
      /data/custom_nginx/stream_top.conf \
      /data/custom_nginx/server_stream.conf \
      /data/custom_nginx/server_stream_tcp.conf \
      /data/custom_nginx/server_stream_udp.conf


if [ ! -s /data/crowdsec/ban.html ]; then
    cp -van /etc/ban.html.original /data/crowdsec/ban.html
fi
cp -a /etc/ban.html.original /data/crowdsec/ban.html.example

if [ ! -s /data/crowdsec/captcha.html ]; then
    cp -van /etc/captcha.html.original /data/crowdsec/captcha.html
fi
cp -a /etc/captcha.html.original /data/crowdsec/captcha.html.example

if [ ! -s /data/crowdsec/crowdsec.conf ]; then
    cp -van /etc/crowdsec.conf.example /data/crowdsec/crowdsec.conf
fi
cp -a /etc/crowdsec.conf.example /data/crowdsec/crowdsec.conf.example
# trailing spaces and Windows line endings would silently keep the bouncer off (and break values like API_KEY)
sed -i "s/[[:space:]]*$//" /data/crowdsec/crowdsec.conf


if [ "$DEFAULT_CERT_ID" = "0" ]; then
    export DEFAULT_CERT=/data/tls/dummycert.pem
    export DEFAULT_KEY=/data/tls/dummykey.pem
    echo "no DEFAULT_CERT_ID set, using dummycerts."
else
    if [ -d "/data/tls/certbot/live/npm-$DEFAULT_CERT_ID" ]; then
        if [ ! -s /data/tls/certbot/live/npm-"$DEFAULT_CERT_ID"/fullchain.pem ]; then
            echo "/data/tls/certbot/live/npm-$DEFAULT_CERT_ID/fullchain.pem does not exist"
            export DEFAULT_CERT=/data/tls/dummycert.pem
            export DEFAULT_KEY=/data/tls/dummykey.pem
            echo "using dummycerts."
        else
            export DEFAULT_CERT=/data/tls/certbot/live/npm-"$DEFAULT_CERT_ID"/fullchain.pem
            echo "DEFAULT_CERT set to /data/tls/certbot/live/npm-$DEFAULT_CERT_ID/fullchain.pem"
            if [ ! -s /data/tls/certbot/live/npm-"$DEFAULT_CERT_ID"/privkey.pem ]; then
                echo "/data/tls/certbot/live/npm-$DEFAULT_CERT_ID/privkey.pem does not exist"
                export DEFAULT_CERT=/data/tls/dummycert.pem
                export DEFAULT_KEY=/data/tls/dummykey.pem
                echo "using dummycerts."
            else
                export DEFAULT_KEY=/data/tls/certbot/live/npm-"$DEFAULT_CERT_ID"/privkey.pem
                echo "DEFAULT_KEY set to /data/tls/certbot/live/npm-$DEFAULT_CERT_ID/privkey.pem"
                if [ -s /data/tls/certbot/live/npm-"$DEFAULT_CERT_ID".der ] && [ "$ACME_OCSP_STAPLING" = "true" ]; then
                     export DEFAULT_STAPLING_FILE=/data/tls/certbot/live/npm-"$DEFAULT_CERT_ID".der
                     echo "DEFAULT_STAPLING_FILE set to /data/tls/certbot/live/npm-$DEFAULT_CERT_ID.der"
                fi
            fi
        fi
    elif [ -d "/data/tls/custom/npm-$DEFAULT_CERT_ID" ]; then
        if [ ! -s /data/tls/custom/npm-"$DEFAULT_CERT_ID"/fullchain.pem ]; then
            echo "/data/tls/custom/npm-$DEFAULT_CERT_ID/fullchain.pem does not exist"
            export DEFAULT_CERT=/data/tls/dummycert.pem
            export DEFAULT_KEY=/data/tls/dummykey.pem
            echo "using dummycerts."
        else
            export DEFAULT_CERT=/data/tls/custom/npm-"$DEFAULT_CERT_ID"/fullchain.pem
            echo "DEFAULT_CERT set to /data/tls/custom/npm-$DEFAULT_CERT_ID/fullchain.pem"
            if [ ! -s /data/tls/custom/npm-"$DEFAULT_CERT_ID"/privkey.pem ]; then
                echo "/data/tls/custom/npm-$DEFAULT_CERT_ID/privkey.pem does not exist"
                export DEFAULT_CERT=/data/tls/dummycert.pem
                export DEFAULT_KEY=/data/tls/dummykey.pem
                echo "using dummycerts."
            else
                export DEFAULT_KEY=/data/tls/custom/npm-"$DEFAULT_CERT_ID"/privkey.pem
                echo "DEFAULT_KEY set to /data/tls/custom/npm-$DEFAULT_CERT_ID/privkey.pem"
                if [ -s /data/tls/custom/npm-"$DEFAULT_CERT_ID".der ] && [ "$CUSTOM_OCSP_STAPLING" = "true" ]; then
                     export DEFAULT_STAPLING_FILE=/data/tls/custom/npm-"$DEFAULT_CERT_ID".der
                     echo "DEFAULT_STAPLING_FILE set to /data/tls/custom/npm-$DEFAULT_CERT_ID.der"
                fi
            fi
        fi
    else
        export DEFAULT_CERT=/data/tls/dummycert.pem
        export DEFAULT_KEY=/data/tls/dummykey.pem
        echo "cert with ID $DEFAULT_CERT_ID does not exist, using dummycerts."
    fi
fi

if { [ "$DEFAULT_CERT" = "/data/tls/dummycert.pem" ] && [ "$DEFAULT_KEY" != "/data/tls/dummykey.pem" ]; } || { [ "$DEFAULT_CERT" != "/data/tls/dummycert.pem" ] && [ "$DEFAULT_KEY" = "/data/tls/dummykey.pem" ]; }; then
    export DEFAULT_CERT=/data/tls/dummycert.pem
    export DEFAULT_KEY=/data/tls/dummykey.pem
    echo "something went wrong, using dummycerts."
fi

# the built-in certificate is always kept: the default certificate can be switched to it at runtime
if [ ! -s /data/tls/dummycert.pem ] || [ ! -s /data/tls/dummykey.pem ]; then
    rm -vrf /data/tls/dummycert.pem /data/tls/dummykey.pem
    openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:secp384r1 -x509 -days 365000 -nodes -subj "/" -sha512 -keyout /data/tls/dummykey.pem -out /data/tls/dummycert.pem
fi
if [ "$DEFAULT_CERT" = "/data/tls/dummycert.pem" ] || [ "$DEFAULT_KEY" = "/data/tls/dummykey.pem" ]; then
    unset DEFAULT_STAPLING_FILE
fi

# default certificate include of default.conf and npmpro.conf, the backend rewrites it from the runtime settings
mkdir -p /data/npmpro/nginx
{
    echo "ssl_certificate $DEFAULT_CERT;"
    echo "ssl_certificate_key $DEFAULT_KEY;"
    if [ -s "$DEFAULT_STAPLING_FILE" ]; then
        echo "ssl_stapling on;"
        echo "ssl_stapling_verify on;"
        echo "ssl_stapling_file $DEFAULT_STAPLING_FILE;"
        echo "ssl_certificate_compression off;"
    fi
} > /data/npmpro/nginx/default-cert.conf

if [ "$GOA" = "true" ]; then
    mkdir -vp /data/goaccess/data /data/goaccess/geoip
fi

if [ "$REGENERATE_ALL" = "true" ]; then
    find /data/nginx -name "*.conf" -delete
fi

if [ -f /data/logrotate.state ] && [ ! -e /data/nginx/logs/logrotate.state ]; then cp -va /data/logrotate.state /data/nginx/logs/logrotate.state; fi

# http access log: included by nginx.conf, the backend rewrites it when the traffic statistics or Write log files
# setting changes
mkdir -p /data/npmpro/nginx
if [ "$LOGROTATE" = "true" ] || [ "$TRAFFIC_STATS" = "true" ]; then
    echo "access_log /data/nginx/logs/access.log alog;" > /data/npmpro/nginx/access-log.conf
    if [ ! -L /data/nginx/access.log ] && [ ! -f /data/nginx/logs/access.log ]; then mv -vn /data/nginx/access.log* /data/nginx/logs; fi
    touch /data/nginx/logs/access.log
    if [ ! -L /data/nginx/access.log ]; then rm -f /data/nginx/access.log; ln -rs /data/nginx/logs/access.log /data/nginx/access.log; fi
else
    echo "access_log off;" > /data/npmpro/nginx/access-log.conf
fi

# error log and stream access log: included by nginx.conf, the backend rewrites them when Write log files changes
# (the same lines as lib/log-files.js logIncludes)
if [ "$LOGROTATE" = "true" ]; then
    echo "error_log /data/nginx/logs/error.log warn;" > /data/npmpro/nginx/error-log.conf
    echo "access_log /data/nginx/logs/stream.log slog;" > /data/npmpro/nginx/stream-log.conf

    if [ ! -L /data/nginx/stream.log ] && [ ! -f /data/nginx/logs/stream.log ]; then mv -vn /data/nginx/stream.log* /data/nginx/logs; fi
    if [ ! -L /data/nginx/error.log ] && [ ! -f /data/nginx/logs/error.log ]; then mv -vn /data/nginx/error.log* /data/nginx/logs; fi

    touch /data/nginx/logs/stream.log \
          /data/nginx/logs/error.log

    if [ ! -L /data/nginx/stream.log ]; then rm -f /data/nginx/stream.log; ln -rs /data/nginx/logs/stream.log /data/nginx/stream.log; fi
    if [ ! -L /data/nginx/error.log ]; then rm -f /data/nginx/error.log; ln -rs /data/nginx/logs/error.log /data/nginx/error.log; fi
else
    echo "# no error log file, errors go to stderr" > /data/npmpro/nginx/error-log.conf
    echo "access_log off;" > /data/npmpro/nginx/stream-log.conf
fi

# secrets live here: TLS keys, htpasswd files, the database and keys, logs, the CrowdSec API key and custom nginx
# snippets (often with tokens); nginx runs as the same user, so 700/600 keeps them readable for it
find /data/tls \
     /data/access \
     /data/npmpro \
     /data/nginx/logs \
     /data/crowdsec \
     /data/custom_nginx \
     -type d \
     -not -perm 700 \
     -exec chmod 700 {} \;

find /data/tls \
     /data/access \
     /data/npmpro \
     /data/nginx/logs \
     /data/crowdsec \
     /data/custom_nginx \
     -type f \
     -not -perm 600 \
     -exec chmod 600 {} \;
