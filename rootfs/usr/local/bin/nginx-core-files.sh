#!/usr/bin/env sh
# Writes the nginx include files of Settings > nginx into $1 from the NGINX_* env vars envs.sh exported. The same
# output as backend/lib/nginx-core.js (backend/test/nginx-core.test.js compares them). data-setup.sh runs it with
# --if-missing: then nothing is written while all four files exist (the backend writes them on every save and start);
# resolver.conf, the fifth file, is written on its own when it is missing.
# --trim-affinity cuts the affinity line of an existing core-main.conf to the CPUs allowed now (see below).
set -eu
# Pin workers to CPUs (NGINX_CPU_AFFINITY off, auto or a CPU list): nginx's mask (CPU 0 right-most) of the allowed
# CPUs (Cpus_allowed_list) or of the list cut to them; no line and a note on stderr (the start log) when that is empty or
# the list cannot be read (backend/lib/nginx-core.js affinityOf does the same)
cpus_of() {
    echo "$1" | grep -Eq "^[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*$" || return 0
    out="$(echo "$1" | awk -F, '{
        for (i = 1; i <= NF; i++) {
            n = split($i, r, "-"); lo = r[1] + 0; hi = (n == 2 ? r[2] : r[1]) + 0
            if (hi < lo || hi >= 1024) exit 1
            for (c = lo; c <= hi; c++) print c
        }
    }')" || return 0
    echo "$out"
}
# --trim-affinity: at boot, before nginx starts, an existing core-main.conf may hold a mask of an earlier CPU set (the
# container was pinned to other CPUs since), and nginx logs sched_setaffinity() failed for a CPU it may not use. Only
# that line is cut to the CPUs allowed now (CPU 0 right-most, the mask as long as its highest CPU, like affinity_line
# writes it) and dropped when none is left or the allowed list cannot be read. The backend rewrites the whole file from
# the setting a moment later.
if [ "$1" = "--trim-affinity" ]; then
    file="$2/core-main.conf"
    [ -f "$file" ] || exit 0
    grep -Eq "^worker_cpu_affinity auto [01]+;$" "$file" || exit 0
    allowed="$(sed -n "s/^Cpus_allowed_list:[[:space:]]*//p" "${NPMPRO_PROC_STATUS:-/proc/self/status}" 2> /dev/null | tr -d " \t")"
    mask="$(awk -v allowed="$(cpus_of "$allowed" | tr "\n" " ")" '
        BEGIN { n = split(allowed, a, " "); for (i = 1; i <= n; i++) ok[a[i]] = 1 }
        /^worker_cpu_affinity auto [01]+;$/ {
            m = $3; sub(/;$/, "", m); len = length(m); top = -1
            for (i = 1; i <= len; i++) {
                c = len - i
                if (substr(m, i, 1) == "1" && (c in ok)) { keep[c] = 1; if (c > top) top = c }
            }
            r = ""
            for (c = top; c >= 0; c--) r = r (keep[c] ? "1" : "0")
            print r
            exit
        }' "$file")"
    # the file is replaced only from a complete, non-empty copy: a failed write (full disk, folder not writable) keeps
    # it as it is. cat over the file keeps its owner and mode, like launch.sh.
    tmp="$file.trim"
    rc=0
    if [ -n "$mask" ]; then
        sed "s/^worker_cpu_affinity auto [01]*;$/worker_cpu_affinity auto $mask;/" "$file" > "$tmp" || rc=$?
    else
        grep -v "^worker_cpu_affinity auto [01]*;$" "$file" > "$tmp" || rc=$?
        # grep answers 1 when it prints no line, which is no error (an empty copy is not used below)
        if [ "$rc" = 1 ]; then rc=0; fi
    fi
    if [ "$rc" = 0 ] && [ -s "$tmp" ]; then
        cat "$tmp" > "$file"
    else
        echo "Pin workers to CPUs: could not cut the affinity line of $file, it is kept as it is" >&2
    fi
    rm -f "$tmp"
    exit 0
fi
header="# written by NPMpro from Settings > nginx and the NGINX_* environment variables, do not edit"
# the resolver directive (backend/lib/nginx-core.js resolverLine): the addresses replace local=on; NGINX_RESOLVER is
# checked by envs.sh, repeated spaces are collapsed like the renderer's parsed list
resolver_line() {
    servers="$(echo "$NGINX_RESOLVER" | tr -s " \t" " " | sed "s/^ //; s/ $//")"
    [ -n "$servers" ] || servers="local=on"
    hosts=off
    [ "$NGINX_RESOLVER_HOSTS" = "true" ] && hosts=on
    ipv6=off
    [ "$NGINX_RESOLVER_IPV6" = "true" ] && ipv6=on
    valid=""
    [ -z "$NGINX_RESOLVER_VALID" ] || valid=" valid=$NGINX_RESOLVER_VALID"
    echo "resolver $servers hosts=$hosts ipv6=$ipv6$valid;"
}
write_resolver() {
    {
        echo "$header"
        resolver_line
    } > "$dir/resolver.conf"
}
if [ "$1" = "--if-missing" ]; then
    dir="$2"
    # resolver.conf is new in this version: an upgrade has the four files but not this one, and nginx.conf includes it
    [ -f "$dir/resolver.conf" ] || write_resolver
    if [ -f "$dir/core-main.conf" ] && [ -f "$dir/core-events.conf" ] && [ -f "$dir/core-http.conf" ] && [ -f "$dir/core-stream.conf" ]; then
        exit 0
    fi
else
    dir="$1"
fi
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
affinity_line() {
    [ "$NGINX_CPU_AFFINITY" = "off" ] && return 0
    allowed="$(sed -n "s/^Cpus_allowed_list:[[:space:]]*//p" "${NPMPRO_PROC_STATUS:-/proc/self/status}" 2> /dev/null | tr -d " \t")"
    allowed_cpus="$(cpus_of "$allowed")"
    if [ -z "$allowed_cpus" ]; then
        echo "Pin workers to CPUs: the container's CPU list cannot be read, workers are not pinned" >&2
        return 0
    fi
    if [ "$NGINX_CPU_AFFINITY" = "auto" ]; then
        cpus="$allowed_cpus"
    else
        cpus="$(cpus_of "$NGINX_CPU_AFFINITY" | grep -Fx "$allowed_cpus" || true)"
    fi
    if [ -z "$cpus" ]; then
        echo "Pin workers to CPUs: none of the CPUs $NGINX_CPU_AFFINITY is allowed in this container ($allowed), workers are not pinned" >&2
        return 0
    fi
    echo "worker_cpu_affinity auto $(echo "$cpus" | awk '{ on[$1] = 1; if ($1 > top) top = $1 } END { s = ""; for (c = top; c >= 0; c--) s = s (on[c] ? "1" : "0"); print s }');"
}
{
    echo "$header"
    echo "worker_processes $NGINX_WORKER_PROCESSES;"
    affinity_line
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
write_resolver
