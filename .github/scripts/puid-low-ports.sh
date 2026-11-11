#!/usr/bin/env sh
# Runs an image with PUID set and the host-network rule for ports below 1024 restored inside a bridge container
# (net.ipv4.ip_unprivileged_port_start=1024), with the compose capabilities and no-new-privileges, and checks that
# nginx binds 80, 443 and 81 and and the backend are the only services holding net_bind_service.
# Usage: puid-low-ports.sh <image> [container name] [extra docker run args...]
set -eu
image=$1
name=${2:-npmpro-puid}
shift $(( $# < 2 ? $# : 2 ))
volume="$name-data"
cleanup() { docker rm -f "$name" > /dev/null 2>&1 || true; docker volume rm "$volume" > /dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker volume create "$volume" > /dev/null
docker run -d --name "$name" \
	--cap-drop ALL --cap-add NET_BIND_SERVICE --cap-add SETGID --cap-add SETUID --cap-add CHOWN \
	--cap-add FOWNER --cap-add DAC_OVERRIDE \
	--security-opt no-new-privileges \
	--sysctl net.ipv4.ip_unprivileged_port_start=1024 \
	-e TZ=UTC -e PUID=1000 -e PGID=1000 \
	-e ACME_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory \
	-v "$volume:/data" "$@" "$image" > /dev/null
healthy=0
for _ in $(seq 1 60); do
	if docker exec "$name" healthcheck.sh > /dev/null 2>&1; then healthy=1; break; fi
	sleep 5
done
fail() { echo "::error::$1"; docker logs --tail 40 "$name" 2>&1 || true; exit 1; }
[ "$healthy" = 1 ] || fail "PUID container did not become healthy (ports below 1024 not bound?)"
for url in http://127.0.0.1:80/ https://127.0.0.1:443/ https://127.0.0.1:81/api; do
	docker exec "$name" curl -sk -o /dev/null --max-time 10 "$url" || fail "nothing answers on $url"
done
cap_amb() { docker exec "$name" awk '/^CapAmb:/ {print $2}' "/proc/$1/status"; }
nginx=$(docker exec "$name" pgrep -o -f '^nginx: master process') || fail "no nginx master"
node=$(docker exec "$name" pgrep -o -x node) || fail "no backend"
crond=$(docker exec "$name" pgrep -o -x crond) || fail "no crond"
[ "$(cap_amb "$nginx")" = 0000000000000400 ] || fail "nginx does not hold net_bind_service: $(cap_amb "$nginx")"
[ "$(cap_amb "$node")" = 0000000000000400 ] || fail "the backend does not hold only net_bind_service (nginx -t binds): $(cap_amb "$node")"
[ "$(cap_amb "$crond")" = 0000000000000000 ] || fail "crond holds ambient capabilities: $(cap_amb "$crond")"
groups=$(docker exec "$name" awk '/^Groups:/ {print $2}' "/proc/$node/status")
[ "$groups" = 1000 ] || fail "the backend's supplementary groups are '$groups', want 1000 (as with su-exec)"
php=$(docker exec "$name" pgrep -o -x php-fpm84 || true)
if [ -n "$php" ]; then
	[ "$(cap_amb "$php")" = 0000000000000000 ] || fail "php-fpm84 holds ambient capabilities: $(cap_amb "$php")"
fi
sleep 10
if docker logs "$name" 2>&1 | grep -E "Permission denied|do not pass nginx -t|Could not write .*ip_ranges|Could not apply the network runtime settings"; then
	fail "the start log shows nginx -t failing"
fi
echo "PUID with ports below 1024 reserved for root: nginx binds 80, 443 and 81; only nginx and the backend hold net_bind_service"
