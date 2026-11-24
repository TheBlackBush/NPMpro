#!/bin/sh
# Installs the NPMpro parser, scenarios and alert context into a CrowdSec container as local items, until the
# collection TheBlackBush/npmpro is on the CrowdSec hub. Run it inside the CrowdSec container, for example:
#   curl -fsSL https://raw.githubusercontent.com/TheBlackBush/NPMpro/develop/scripts/crowdsec-npmpro.sh | docker exec -i crowdsec sh
# Options (after "sh -s --" when piped): --remove deletes the local items again, --help shows the usage.
# The items are part of this file, so nothing else is downloaded; cscli installs the hub items they need.
set -eu

ITEMS_COMMIT="39fa787"
CONF="${CROWDSEC_CONFIG_DIR:-/etc/crowdsec}"
STAMP="$(date +%Y%m%d-%H%M%S)"
HUB_COLLECTIONS="crowdsecurity/base-http-scenarios crowdsecurity/appsec-virtual-patching crowdsecurity/appsec-generic-rules crowdsecurity/appsec-wordpress crowdsecurity/wordpress"
HUB_PARSERS="crowdsecurity/syslog-logs crowdsecurity/dateparse-enrich"
HUB_SCENARIOS="crowdsecurity/nginx-req-limit-exceeded"
LOCAL_FILES="parsers/s01-parse/npmpro-logs.yaml scenarios/npmpro-login-bf.yaml scenarios/npmpro-bad-requests.yaml scenarios/npmpro-stream-flood.yaml scenarios/npmpro-tls-probe.yaml scenarios/npmpro-stream-tls-probe.yaml contexts/npmpro.yaml"

say() { printf '%s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
fail() {
	printf 'Error: %s\n' "$*" >&2
	exit 1
}

usage() {
	say "Usage: crowdsec-npmpro.sh [--remove]"
	say "  (no option)  install the NPMpro parser, scenarios and alert context as local CrowdSec items"
	say "  --remove     delete these local items (before installing TheBlackBush/npmpro from the hub)"
	say "Set CROWDSEC_CONFIG_DIR when the CrowdSec config is not in /etc/crowdsec."
}

# keeps a copy of $CONF/$1 in $CONF/npmpro-backup/<date>/ (outside the folders CrowdSec loads) before it changes
backup() {
	copy="$CONF/npmpro-backup/$STAMP/$1"
	mkdir -p "$(dirname "$copy")"
	cp -p "$CONF/$1" "$copy"
	say "  saved the old $CONF/$1 as $copy"
}

# writes stdin to $CONF/$1, keeping a backup when a different file is already there
put() {
	target="$CONF/$1"
	tmp="$(mktemp)"
	cat >"$tmp"
	mkdir -p "$(dirname "$target")"
	if [ -f "$target" ] && cmp -s "$tmp" "$target"; then
		rm -f "$tmp"
		say "  $target is current"
		return
	fi
	if [ -f "$target" ]; then backup "$1"; fi
	cat "$tmp" >"$target"
	rm -f "$tmp"
	say "  wrote $target"
}

# 1.6.4 or newer reads the alert context (older versions refuse to start with it)
context_supported() {
	version="$(cscli version 2>&1 | sed -n 's/^version: v\{0,1\}\([0-9][0-9.]*\).*/\1/p' | head -n 1)"
	major="$(printf '%s' "$version" | cut -d. -f1)"
	minor="$(printf '%s' "$version" | cut -d. -f2)"
	patch="$(printf '%s' "$version" | cut -d. -f3)"
	[ -n "$major" ] || return 1
	[ "$major" -gt 1 ] && return 0
	[ "$major" -eq 1 ] || return 1
	[ "${minor:-0}" -gt 6 ] && return 0
	[ "${minor:-0}" -eq 6 ] && [ "${patch:-0}" -ge 4 ]
}

check_container() {
	command -v cscli >/dev/null 2>&1 || fail "cscli was not found: run this script inside the CrowdSec container (docker exec -i crowdsec sh)"
	[ -f "$CONF/config.yaml" ] || fail "$CONF/config.yaml was not found: set CROWDSEC_CONFIG_DIR to the CrowdSec config folder"
	if [ -r /proc/self/mountinfo ] && ! awk -v dir="$CONF" '$5 == dir { found = 1 } END { exit !found }' /proc/self/mountinfo; then
		warn "$CONF is not a mounted folder: the items are lost when the container is recreated. Mount it from the host (see the NPMpro wiki, CrowdSec) and run this script again."
	fi
}

remove() {
	check_container
	say "Removing the local NPMpro items from $CONF"
	for file in $LOCAL_FILES; do
		target="$CONF/$file"
		if [ -f "$target" ]; then
			backup "$file"
			rm -f "$target"
			say "  removed $target"
		fi
	done
	say ""
	say "Done. The acquisition keeps type: npmpro, which the hub collection reads too."
	say "Install the collection from the hub (cscli collections install TheBlackBush/npmpro, or add it to the"
	say "COLLECTIONS variable of the container) and restart the CrowdSec container."
}

switch_acquisition() {
	found=""
	for file in "$CONF/acquis.yaml" "$CONF"/acquis.d/*.yaml "$CONF"/acquis.d/*.yml; do
		[ -f "$file" ] || continue
		if grep -Eq '^[[:space:]]*type:[[:space:]]*npmplus[[:space:]]*$' "$file"; then
			backup "${file#"$CONF"/}"
			sed -i 's/^\([[:space:]]*type:[[:space:]]*\)npmplus[[:space:]]*$/\1npmpro/' "$file"
			say "  $file: type npmplus is now type npmpro"
		fi
		if grep -Eq '^[[:space:]]*type:[[:space:]]*npmpro[[:space:]]*$' "$file"; then found="yes"; fi
	done
	if [ -z "$found" ]; then
		warn "no acquisition file with type: npmpro was found. Create $CONF/acquis.d/npmpro.yaml as step 4 of the NPMpro wiki page CrowdSec shows, with type: npmpro."
	fi
}

install() {
	check_container
	say "Installing the NPMpro items (hub branch commit $ITEMS_COMMIT) into $CONF"
	say "Hub items they need:"
	cscli hub update >/dev/null
	# shellcheck disable=SC2086 # the lists are space separated on purpose
	cscli collections install $HUB_COLLECTIONS
	# shellcheck disable=SC2086
	cscli parsers install $HUB_PARSERS
	# shellcheck disable=SC2086
	cscli scenarios install $HUB_SCENARIOS
	say "Local items:"
	write_items
	if context_supported; then
		write_context
	else
		warn "this CrowdSec is older than 1.6.4, which refuses the alert context: it was not installed. Update CrowdSec and run this script again to add it."
	fi
	say "Acquisition:"
	switch_acquisition
	say "Checking the configuration:"
	if crowdsec -c "$CONF/config.yaml" -t >/dev/null 2>&1; then
		say "  the configuration is valid"
	else
		warn "crowdsec -t found an error. Run 'crowdsec -c $CONF/config.yaml -t' to see it; this script with --remove takes the items out again."
		exit 1
	fi
	say ""
	say "Done. Restart the CrowdSec container now (docker restart crowdsec) so it loads the items."
	say "Keep the hub items when the container is recreated: set its COLLECTIONS variable to"
	say "  $HUB_COLLECTIONS"
	say "and SCENARIOS to $HUB_SCENARIOS (in place of ZoeyVid/npmplus)."
}

# BEGIN ITEMS (generated from the hub branch, do not edit by hand)
write_items() {
	put parsers/s01-parse/npmpro-logs.yaml <<'NPMPRO_ITEM'
filter: "evt.Parsed.program startsWith 'npmpro'"
onsuccess: next_stage
name: TheBlackBush/npmpro-logs
description: "Parse NPMpro access logs (classic and JSON), stream logs (classic and JSON), the limit_req lines of the error log and the TLS handshake log"
nodes:
  - grok:
      pattern: '\[%{HTTPDATE:time_local}\] %{DATA:host}(?::%{NONNEGINT})? %{IPORHOST:remote_addr} %{NUMBER} "%{WORD:verb} %{DATA:request} HTTP/%{NUMBER:http_version}" %{NUMBER:status} %{NUMBER} "%{NOTDQUOTE:http_referer}" "%{NOTDQUOTE:http_user_agent}" "%{NOTDQUOTE:remote_user}"(?: "%{NOTDQUOTE}" (?:%{NOTSPACE})? (?:%{NOTSPACE})? (?:%{NOTSPACE})? (?:%{NOTSPACE})?(?: (?:%{NONNEGINT:server_port})?(?: "%{NOTDQUOTE:server_name}" %{NOTSPACE:host_id} %{NOTSPACE:request_id} %{NONNEGINT:connection} "%{NOTDQUOTE:upstream_status}" "%{NOTDQUOTE:upstream_response_time}")?)?)?'
      apply_on: message
      statics:
        - meta: log_type
          value: http_access-log
        - target: evt.StrTime
          expression: evt.Parsed.time_local
        - parsed: target_fqdn
          expression: "evt.Parsed.server_name != '' ? evt.Parsed.server_name : evt.Parsed.host"
    onsuccess: next_stage
    nodes:
      - filter: "evt.Parsed.status == '401' && evt.Parsed.remote_user != '-'"
        statics:
          - meta: sub_type
            value: "auth_fail"
          - meta: username
            expression: evt.Parsed.remote_user
  ## Parse malformed requests
  - grok:
      pattern: '\[%{HTTPDATE:time_local}\] %{DATA:host}(?::%{NONNEGINT})? %{IPORHOST:remote_addr} %{NUMBER} "%{DATA:request}" %{NUMBER:status} %{NUMBER} "%{NOTDQUOTE:http_referer}" "%{NOTDQUOTE:http_user_agent}" "%{NOTDQUOTE:remote_user}"(?: "%{NOTDQUOTE}" (?:%{NOTSPACE})? (?:%{NOTSPACE})? (?:%{NOTSPACE})? (?:%{NOTSPACE})?(?: (?:%{NONNEGINT:server_port})?(?: "%{NOTDQUOTE:server_name}" %{NOTSPACE:host_id} %{NOTSPACE:request_id} %{NONNEGINT:connection} "%{NOTDQUOTE:upstream_status}" "%{NOTDQUOTE:upstream_response_time}")?)?)?'
      apply_on: message
    statics:
      - meta: log_type
        value: http_access-log
      - target: evt.StrTime
        expression: evt.Parsed.time_local
      - parsed: target_fqdn
        expression: "evt.Parsed.server_name != '' ? evt.Parsed.server_name : evt.Parsed.host"
  ## Parse the JSON stream log (it must come before the JSON access node: both start with a brace)
  ## Both JSON nodes check the raw line for fields only NPMpro writes and for the closing brace, so a foreign or truncated
  ## JSON line stays unparsed and never becomes an empty event.
  - filter: "evt.Parsed.message startsWith '{' && evt.Parsed.message endsWith '}' && evt.Parsed.message contains ',\"session_time\":\"' && evt.Parsed.message contains ',\"stream_id\":\"'"
    statics:
      - parsed: npmpro_json
        expression: UnmarshalJSON(evt.Parsed.message, evt.Unmarshaled, "npmpro")
      - meta: log_type
        value: npmpro_stream-log
      - target: evt.StrTime
        expression: evt.Unmarshaled.npmpro.time_local
      - parsed: server_port
        expression: evt.Unmarshaled.npmpro.server_port
      - parsed: remote_addr
        expression: evt.Unmarshaled.npmpro.remote_addr
      - parsed: status
        expression: evt.Unmarshaled.npmpro.status
      - parsed: stream_id
        expression: evt.Unmarshaled.npmpro.stream_id
    onsuccess: next_stage
  ## Parse the JSON access log. The nodes below run one after the other (the parent has no onsuccess):
  ## the first reads the fields, the next ones split the request line and mark a failed basic auth, because the statics
  ## of a node run after its grok and its child nodes.
  ## A line from a unix socket client (remote_addr `unix:`) has no client address and is dropped on purpose, as it is in the classic
  ## format (no grok matches it).
  - filter: "evt.Parsed.message startsWith '{' && evt.Parsed.message endsWith '}' && evt.Parsed.message contains ',\"host_id\":\"' && evt.Parsed.message contains ',\"request_id\":\"' && !(evt.Parsed.message contains ',\"remote_addr\":\"unix:\",')"
    nodes:
      - statics:
          - parsed: npmpro_format
            value: json
          - parsed: npmpro_json
            expression: UnmarshalJSON(evt.Parsed.message, evt.Unmarshaled, "npmpro")
          - meta: log_type
            value: http_access-log
          - target: evt.StrTime
            expression: evt.Unmarshaled.npmpro.time_local
          - parsed: host
            expression: evt.Unmarshaled.npmpro.host
          - parsed: remote_addr
            expression: evt.Unmarshaled.npmpro.remote_addr
          - parsed: request
            expression: evt.Unmarshaled.npmpro.request
          - parsed: status
            expression: evt.Unmarshaled.npmpro.status
          - parsed: http_referer
            expression: "evt.Unmarshaled.npmpro.http_referer != '' ? evt.Unmarshaled.npmpro.http_referer : '-'"
          - parsed: http_user_agent
            expression: "evt.Unmarshaled.npmpro.http_user_agent != '' ? evt.Unmarshaled.npmpro.http_user_agent : '-'"
          - parsed: remote_user
            expression: "evt.Unmarshaled.npmpro.remote_user != '' ? evt.Unmarshaled.npmpro.remote_user : '-'"
          - parsed: server_port
            expression: evt.Unmarshaled.npmpro.server_port
          - parsed: server_name
            expression: evt.Unmarshaled.npmpro.server_name
          - parsed: host_id
            expression: evt.Unmarshaled.npmpro.host_id
          - parsed: request_id
            expression: evt.Unmarshaled.npmpro.request_id
          - parsed: connection
            expression: evt.Unmarshaled.npmpro.connection
          - parsed: upstream_status
            expression: evt.Unmarshaled.npmpro.upstream_status
          - parsed: upstream_response_time
            expression: evt.Unmarshaled.npmpro.upstream_response_time
          - parsed: target_fqdn
            expression: "evt.Unmarshaled.npmpro.server_name != '' ? evt.Unmarshaled.npmpro.server_name : evt.Unmarshaled.npmpro.host"
      ## split the request line; a request that does not match keeps `request` as the raw field
      - filter: "evt.Parsed.npmpro_format == 'json'"
        grok:
          pattern: '%{WORD:verb} %{DATA:request} HTTP/%{NUMBER:http_version}'
          expression: evt.Unmarshaled.npmpro.request
      ## a failed basic auth (this node has no filter, so it always succeeds: the result of a parent node is the result of its last child)
      - statics:
          - meta: sub_type
            expression: "evt.Parsed.status == '401' && evt.Parsed.remote_user != '-' ? 'auth_fail' : ''"
          - meta: username
            expression: "evt.Parsed.status == '401' && evt.Parsed.remote_user != '-' ? evt.Parsed.remote_user : ''"
  ## Parse the classic stream log (an empty port or protocol is allowed, and so is a line without the stream id)
  - grok:
      pattern: '^\[%{HTTPDATE:time_local}\] (?:%{NONNEGINT:server_port})? %{IPORHOST:remote_addr} %{NOTSPACE:protocol} (?:%{NOTSPACE:ssl_preread_protocol})? %{NUMBER:status} %{NUMBER} %{NUMBER} %{NUMBER}(?: %{NOTSPACE:stream_id})?$'
      apply_on: message
      statics:
        - meta: log_type
          value: npmpro_stream-log
        - target: evt.StrTime
          expression: evt.Parsed.time_local
    onsuccess: next_stage
  ## Parse the limit_req lines of the error log. Failed basic auth lines are not parsed on purpose:
  ## the access log has the 401 line of the same request, and parsing both would count it twice.
  ## (tls.log repeats the error lines of the default site and the admin UI: they are counted from error.log only)
  - filter: "evt.Parsed.message contains 'limiting requests, excess' && !(evt.Line.Src endsWith '/tls.log' || evt.Line.Src == 'tls.log')"
    grok:
      pattern: '(%{IPORHOST} )?%{NGINXERRTIME:time} \[%{LOGLEVEL}\] %{NONNEGINT}#%{NONNEGINT}: (\*%{NONNEGINT} )?%{GREEDYDATA:message}, client: %{IPORHOST:remote_addr}, server: %{DATA}, request: "%{WORD:verb} ([^/]+)?%{DATA:request}( HTTP/%{NUMBER:http_version})?"(?:, subrequest: "%{NOTDQUOTE}")?(?:, upstream: "%{NOTDQUOTE}")?(?:, host: "%{DATA:target_fqdn}(?::%{NONNEGINT})?")?'
      apply_on: message
    statics:
      - meta: log_type
        value: http_error-log
      - target: evt.StrTime
        expression: evt.Parsed.time
      - meta: sub_type
        value: "req_limit_exceeded"
    onsuccess: next_stage

  ## Parse the TLS handshake log (tls.log, NPMpro setting TLS handshake log): rejected handshakes, failed handshakes
  ## with the aws-lc reason, plain HTTP on the TLS port and connections closed during the handshake. QUIC lines are
  ## the ones handled "while handling frames". The other lines of the file are unparsed on purpose.
  - filter: "evt.Parsed.message contains ' [info] ' && (evt.Parsed.message contains ' while SSL handshaking, client: ' || evt.Parsed.message contains ' handshake rejected while ' || evt.Parsed.message contains ' while handling frames, client: ' || evt.Parsed.message contains ' client sent plain HTTP request to HTTPS port while ')"
    grok:
      pattern: '%{NGINXERRTIME:time} \[info\] %{NONNEGINT}#%{NONNEGINT}: \*%{NONNEGINT:connection} (?:SSL_do_handshake\(\) failed \(SSL: error:[0-9a-fA-F]+:SSL routines:[A-Za-z_]+:%{WORD:tls_error}(?:[: ][^)]*)?\)|%{DATA:tls_message}) while %{DATA:tls_stage}, client: %{IPORHOST:remote_addr}, server: (?:\S+:%{NONNEGINT:server_port}|[^,]*)(?:, .*)?$'
      apply_on: message
    statics:
      - meta: log_type
        value: npmpro_tls-handshake
      - target: evt.StrTime
        expression: evt.Parsed.time
      - meta: tls_error
        expression: evt.Parsed.tls_error
      - meta: tls_transport
        expression: "evt.Parsed.tls_stage == 'handling frames' ? 'quic' : 'tcp'"
      - meta: sub_type
        expression: >-
          evt.Parsed.tls_error in ['UNSUPPORTED_PROTOCOL', 'NO_APPLICATION_PROTOCOL'] ? 'protocol' :
          (evt.Parsed.tls_error in ['NO_SHARED_CIPHER', 'NO_COMMON_SIGNATURE_ALGORITHMS'] ? 'cipher' :
          (evt.Parsed.tls_error in ['WRONG_VERSION_NUMBER', 'EXCESSIVE_MESSAGE_SIZE', 'HTTP_REQUEST', 'HTTPS_PROXY_REQUEST'] ? 'garbage' :
          (evt.Parsed.tls_error != '' ? 'other' :
          (evt.Parsed.tls_message == 'handshake rejected' ? 'rejected' :
          (evt.Parsed.tls_message == 'client sent plain HTTP request to HTTPS port' ? 'garbage' :
          ((evt.Parsed.tls_message startsWith 'peer closed connection in SSL handshake' || evt.Parsed.tls_message == 'client closed connection') ? 'closed' : 'other'))))))
    onsuccess: next_stage

# these ones apply for all grok patterns
statics:
  - meta: service
    expression: "evt.Meta.log_type startsWith 'http_' ? 'http' : 'tcp'"
  - meta: source_ip
    expression: "evt.Parsed.remote_addr"
  - meta: http_status
    expression: "evt.Meta.log_type startsWith 'http_' ? evt.Parsed.status : ''"
  - meta: http_path
    expression: "evt.Meta.log_type startsWith 'http_' ? evt.Parsed.request : ''"
  - meta: http_verb
    expression: "evt.Meta.log_type startsWith 'http_' ? evt.Parsed.verb : ''"
  - meta: http_user_agent
    expression: "evt.Meta.log_type startsWith 'http_' ? evt.Parsed.http_user_agent : ''"
  - meta: target_fqdn
    expression: "evt.Meta.log_type startsWith 'http_' ? evt.Parsed.target_fqdn : ''"
  - meta: target_port
    expression: "evt.Parsed.server_port"
  - meta: stream_id
    expression: "evt.Meta.log_type == 'npmpro_stream-log' ? evt.Parsed.stream_id : ''"
  - meta: host_id
    expression: "evt.Parsed.host_id"
  - meta: request_id
    expression: "evt.Parsed.request_id"
  - meta: connection
    expression: "evt.Parsed.connection"
NPMPRO_ITEM
	put scenarios/npmpro-login-bf.yaml <<'NPMPRO_ITEM'
type: leaky
name: TheBlackBush/npmpro-login-bf
description: "Detect bruteforce on the NPMpro web UI login"
filter: "evt.Meta.log_type == 'http_access-log' && (evt.Meta.host_id == 'npmpro' || (evt.Meta.host_id == '' && evt.Meta.target_port == '81')) && evt.Meta.http_verb == 'POST' && evt.Meta.http_status in ['401', '403', '429'] && evt.Meta.http_path matches '^/api/tokens(/totp)?([?]|$)'"
groupby: evt.Meta.source_ip
capacity: 5
leakspeed: "2m"
blackhole: 5m
labels:
  service: npmpro
  confidence: 3
  spoofable: 0
  classification:
    - attack.T1110
  behavior: "http:bruteforce"
  label: "NPMpro Login Bruteforce"
  remediation: true
NPMPRO_ITEM
	put scenarios/npmpro-bad-requests.yaml <<'NPMPRO_ITEM'
type: leaky
name: TheBlackBush/npmpro-bad-requests
description: "Detect clients that send many bad requests to NPMpro (400 from nginx itself, or 444 from the default site)"
filter: "evt.Meta.log_type == 'http_access-log' && ((evt.Meta.http_status == '400' && evt.Parsed.upstream_status in ['', '-']) || (evt.Meta.http_status == '444' && evt.Meta.host_id == 'default'))"
groupby: evt.Meta.source_ip
capacity: 10
leakspeed: "10s"
blackhole: 5m
labels:
  service: http
  confidence: 2
  spoofable: 0
  classification:
    - attack.T1595
  behavior: "http:scan"
  label: "NPMpro bad requests"
  remediation: true
NPMPRO_ITEM
	put scenarios/npmpro-stream-flood.yaml <<'NPMPRO_ITEM'
type: leaky
name: TheBlackBush/npmpro-stream-flood
description: "Detect clients that open too many connections to an NPMpro stream"
filter: "evt.Meta.log_type == 'npmpro_stream-log'"
groupby: "evt.Meta.source_ip + '/' + (evt.Meta.stream_id not in ['', '-'] ? evt.Meta.stream_id : evt.Meta.target_port)"
capacity: 40
leakspeed: "1s"
blackhole: 1m
labels:
  service: tcp
  confidence: 1
  spoofable: 0
  classification:
    - attack.T1498
  behavior: "tcp:scan"
  label: "NPMpro stream connection flood"
  remediation: true
NPMPRO_ITEM
	put scenarios/npmpro-tls-probe.yaml <<'NPMPRO_ITEM'
type: leaky
name: TheBlackBush/npmpro-tls-probe
description: "Detect clients that probe NPMpro at the TLS layer: rejected handshakes, old TLS versions, no shared cipher and data that is not TLS"
filter: "evt.Meta.log_type == 'npmpro_tls-handshake' && evt.Meta.sub_type in ['rejected', 'protocol', 'cipher', 'garbage']"
groupby: "evt.Meta.source_ip + '/' + evt.Meta.tls_transport"
capacity: 10
leakspeed: "30s"
blackhole: 5m
labels:
  service: tcp
  confidence: 2
  spoofable: 0
  classification:
    - attack.T1595
  behavior: "tcp:scan"
  label: "NPMpro TLS probe"
  remediation: true
NPMPRO_ITEM
	put scenarios/npmpro-stream-tls-probe.yaml <<'NPMPRO_ITEM'
type: leaky
name: TheBlackBush/npmpro-stream-tls-probe
description: "Detect clients whose connections to an NPMpro TLS stream keep failing before the TLS handshake ends (stream log status 500)"
filter: "evt.Meta.log_type == 'npmpro_stream-log' && evt.Parsed.status == '500'"
groupby: "evt.Meta.source_ip + '/' + (evt.Meta.stream_id not in ['', '-'] ? evt.Meta.stream_id : evt.Meta.target_port)"
capacity: 15
leakspeed: "5s"
blackhole: 5m
labels:
  service: tcp
  confidence: 1
  spoofable: 0
  classification:
    - attack.T1595
  behavior: "tcp:scan"
  label: "NPMpro TLS stream probe"
  remediation: true
NPMPRO_ITEM
}

write_context() {
	put contexts/npmpro.yaml <<'NPMPRO_ITEM'
context:
  request_id:
    - "req.Method != '' ? req.Header.Get('X-Npmpro-Request-Id') : ''"
NPMPRO_ITEM
}
# END ITEMS

case "${1:-}" in
"") install ;;
--remove) remove ;;
-h | --help) usage ;;
*)
	usage >&2
	exit 2
	;;
esac
