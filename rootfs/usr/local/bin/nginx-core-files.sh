#!/usr/bin/env sh
# Writes the nginx include files of Settings > nginx into $1 from the NGINX_* env vars envs.sh exported. The same
# output as backend/lib/nginx-core.js (backend/test/nginx-core.test.js compares them). data-setup.sh runs it with
# --if-missing: then nothing is written while all four files exist (the backend writes them on every save and start).
set -eu
if [ "$1" = "--if-missing" ]; then
    dir="$2"
    if [ -f "$dir/core-main.conf" ] && [ -f "$dir/core-events.conf" ] && [ -f "$dir/core-http.conf" ] && [ -f "$dir/core-stream.conf" ]; then
        exit 0
    fi
else
    dir="$1"
fi
header="# written by NPMpro from Settings > nginx and the NGINX_* environment variables, do not edit"
sigalgs="mldsa87:mldsa65:mldsa44:ed25519:ecdsa_secp521r1_sha512:ecdsa_secp384r1_sha384:ecdsa_secp256r1_sha256:rsa_pss_rsae_sha512:rsa_pss_rsae_sha384:rsa_pss_rsae_sha256"
if [ "$NGINX_TRUST_RSA_PKCS1" = "true" ]; then sigalgs="$sigalgs:rsa_pkcs1_sha512:rsa_pkcs1_sha384:rsa_pkcs1_sha256"; fi
if [ "$NGINX_FORCE_X25519MLKEM768" = "true" ]; then
    curves="X25519MLKEM768"
elif [ "$NGINX_TRUST_SECPR1" = "true" ]; then
    curves="X25519MLKEM768:x25519:secp521r1:secp384r1:prime256v1"
else
    curves="X25519MLKEM768:x25519"
fi
if [ "$NGINX_DISABLE_TLS12" = "true" ] || [ "$NGINX_FORCE_X25519MLKEM768" = "true" ]; then protocols="TLSv1.3"; else protocols="TLSv1.2 TLSv1.3"; fi
tls() {
    echo "ssl_protocols $protocols;"
    echo "ssl_ecdh_curve $curves;"
    echo "ssl_sigalgs $sigalgs;"
    if [ "$NGINX_LOAD_NJS_MODULE" = "true" ]; then echo "js_engine qjs;"; fi
}
{
    echo "$header"
    echo "worker_processes $NGINX_WORKER_PROCESSES;"
    if [ "$NGINX_WORKER_SHUTDOWN_TIMEOUT" != "0" ]; then echo "worker_shutdown_timeout $NGINX_WORKER_SHUTDOWN_TIMEOUT;"; fi
    if [ "$NGINX_LOAD_NJS_MODULE" = "true" ]; then
        echo "load_module modules/ngx_http_js_module.so;"
        echo "load_module modules/ngx_stream_js_module.so;"
    fi
    if [ "$NGINX_LOAD_LDAP_MODULE" = "true" ]; then echo "load_module modules/ngx_http_auth_ldap_module.so;"; fi
    if [ "$NGINX_LOAD_NTLM_MODULE" = "true" ]; then echo "load_module modules/ngx_http_upstream_ntlm_module.so;"; fi
    if [ "$NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE" = "true" ]; then echo "load_module modules/ngx_http_vhost_traffic_status_module.so;"; fi
} > "$dir/core-main.conf"
# 512 is nginx's own default and left out, so a custom events.conf may set it
{
    echo "$header"
    if [ "$NGINX_WORKER_CONNECTIONS" != "512" ]; then echo "worker_connections $NGINX_WORKER_CONNECTIONS;"; fi
} > "$dir/core-events.conf"
{
    echo "$header"
    if [ "$NGINX_LOG_NOT_FOUND" = "true" ]; then echo "log_not_found on;"; else echo "log_not_found off;"; fi
    tls
} > "$dir/core-http.conf"
{
    echo "$header"
    tls
} > "$dir/core-stream.conf"
