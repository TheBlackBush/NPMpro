#!/usr/bin/env sh

# Docker runs this as root: it reads only the root-owned snapshot envs.sh writes, never /data, and calls only the
# system binaries
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077

GOA=false
PHP83=false
PHP84=false
PHP85=false
NPM_PORT=81
NPM_IPV4_BINDING=127.0.0.1
if [ -f /etc/npmpro/healthcheck.env ] && [ ! -L /etc/npmpro/healthcheck.env ]; then
    while IFS= read -r line; do
        case "$line" in
            GOA=true | GOA=false) GOA="${line#*=}" ;;
            PHP83=true | PHP83=false) PHP83="${line#*=}" ;;
            PHP84=true | PHP84=false) PHP84="${line#*=}" ;;
            PHP85=true | PHP85=false) PHP85="${line#*=}" ;;
            NPM_PORT=[0-9] | NPM_PORT=[0-9][0-9] | NPM_PORT=[0-9][0-9][0-9] | NPM_PORT=[0-9][0-9][0-9][0-9] | NPM_PORT=[0-9][0-9][0-9][0-9][0-9]) NPM_PORT="${line#*=}" ;;
            NPM_IPV4_BINDING=*)
                case "${line#*=}" in
                    "" | *[!0-9.]*) ;;
                    *) NPM_IPV4_BINDING="${line#*=}" ;;
                esac
                ;;
        esac
    done < /etc/npmpro/healthcheck.env
fi

if (if [ "$GOA" = "true" ]; then [ -f /tmp/goa/index.html ] && [ -S /run/goaccess.sock ]; fi && if [ "$PHP83" = true ]; then cgi-fcgi -bind -connect /run/php83.sock > /dev/null 2>&1; fi && if [ "$PHP84" = true ]; then cgi-fcgi -bind -connect /run/php84.sock > /dev/null 2>&1; fi && if [ "$PHP85" = true ]; then cgi-fcgi -bind -connect /run/php85.sock > /dev/null 2>&1; fi && [ "$(curl -A "NPMpro/healthcheck" -sSk https://"$NPM_IPV4_BINDING":"$NPM_PORT"/api | jq --raw-output .status)" = "OK" ]); then
	echo "OK"
	exit 0
else
	echo "NOT OK"
	exit 1
fi
