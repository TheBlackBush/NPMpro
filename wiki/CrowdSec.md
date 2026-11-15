# CrowdSec

CrowdSec blocks IPs that attack your hosts. With NPMpro it works in two parts:

- **The CrowdSec engine** (the Security Engine with its Local API, "LAPI") runs in its own container. It reads the NPMpro access log, detects attacks with scenarios (scans, brute force, known exploits) and decides which IPs to ban.
- **The bouncer** is built into NPMpro: a Lua module in nginx asks the LAPI about every client IP and answers banned IPs with a ban page (HTTP 403) instead of forwarding the request.
- **AppSec** (optional, but part of the default setup below) is the web application firewall of CrowdSec. The bouncer sends each request to the AppSec listener of the engine, which blocks requests that match known attacks (for example virtual patches for known CVEs) before they reach your service.

The bouncer covers all HTTP traffic of nginx: proxy hosts, redirection hosts, 404 hosts, the default site and the web UI port. Streams (TCP/UDP) are not covered; use a firewall bouncer for them (see [Firewall bouncer](#firewall-bouncer)).

The paths below assume the default volumes: NPMpro data in `/opt/npmpro` and CrowdSec in `/opt/crowdsec` on the host. If you use other host paths, change them everywhere.

## Requirements

- NPMpro with `network_mode: host` (the default in `compose.yaml`). Then nginx sees the real client IPs and reaches the CrowdSec ports on `127.0.0.1`. Without host networking, the LAPI and AppSec ports must be reachable from inside the NPMpro container and you have to change the LAPI URL and the AppSec URL in step 7 to match.
- If NPMpro sits behind another proxy, CDN or tunnel, set up Trusted proxy IPs (or Trust Cloudflare) first, see [Troubleshooting](Troubleshooting#the-logs-show-the-wrong-client-ips). Otherwise CrowdSec bans the IP of that proxy.
- Write log files (step 3): CrowdSec reads `access.log` from the NPMpro data folder. NPMpro turns it on by itself while CrowdSec is enabled.
- The host ports 8080 (LAPI) and 7422 (AppSec) free on `127.0.0.1`. If something else uses 8080 there, for example NPMpro itself with `HTTP_PORT=8080`, publish the LAPI on another host port and use that port in the LAPI URL (Settings, CrowdSec).

## Setup step by step

### 1. Add the CrowdSec container

`compose.yaml` contains a commented `crowdsec` service. Uncomment it (remove the `#` at the start of each line of the service, keep the indentation) so it looks like this, and set `TZ`:

```yaml
  crowdsec:
    container_name: crowdsec
    restart: unless-stopped
    image: docker.io/crowdsecurity/crowdsec:latest
    pull_policy: always
    network_mode: bridge
    ports:
      - "127.0.0.1:7422:7422"
      - "127.0.0.1:8080:8080"
    environment:
      - "TZ=Europe/Berlin" # your time zone
      - "USE_WAL=true"
      - "COLLECTIONS=ZoeyVid/npmplus"
    volumes:
      - "/opt/crowdsec/conf:/etc/crowdsec"
      - "/opt/crowdsec/data:/var/lib/crowdsec/data"
      - "/opt/npmpro/nginx/logs:/opt/npmpro/nginx/logs:ro"
```

- `COLLECTIONS=ZoeyVid/npmplus` installs the CrowdSec hub collection for this proxy: the parser for the NPMpro access log, the generic HTTP scenarios, the AppSec rules (virtual patching and generic rules) and `crowdsecurity/nginx-req-limit-exceeded`. The collection, its log type and the bouncer name keep their original NPMplus spelling, because they are names on the CrowdSec hub.
- The last volume gives CrowdSec read-only access to the NPMpro logs, at the same path as on the host.
- The ports are only published on `127.0.0.1`, so the LAPI and AppSec are not reachable from your network.

Optional collections, added to the same variable separated by spaces (for example `COLLECTIONS=ZoeyVid/npmplus crowdsecurity/http-dos`):

| Collection | What it adds |
|---|---|
| [crowdsecurity/http-dos](https://app.crowdsec.net/hub/author/crowdsecurity/collections/http-dos) | detects HTTP DoS tools that the default HTTP scenarios miss; expect some false positives |
| [crowdsecurity/appsec-crs](https://app.crowdsec.net/hub/author/crowdsecurity/collections/appsec-crs) | the OWASP Core Rule Set for AppSec. It is loaded out-of-band: matching requests are not blocked, but an IP that triggers more than 5 rules gets banned. Also uncomment `crowdsecurity/crs` in step 4 |
| [crowdsecurity/http-extended-context](https://app.crowdsec.net/hub/author/crowdsecurity/collections/http-extended-context) | adds the attacked domain to the alert context, which is sent to CrowdSec if your engine is enrolled in the CrowdSec console |

Start it once, so that it creates its configuration in `/opt/crowdsec/conf`:

```bash
docker compose up -d crowdsec
docker logs crowdsec
```

### 2. Update the hub

The CrowdSec image can ship an outdated hub index, and with it an old version of the parser for the NPMpro access log that parses none of the log lines (`ZoeyVid/npmplus-logs` before 0.4). Update the hub index and all installed collections, parsers and scenarios, then restart CrowdSec:

```bash
docker exec crowdsec cscli hub update
docker exec crowdsec cscli hub upgrade
docker restart crowdsec
```

Run the two `cscli hub` commands again from time to time (or after pulling a new CrowdSec image) to get updated parsers, scenarios and AppSec rules.

### 3. Log files (on by themselves)

Nothing to do here: once you enable CrowdSec in step 7 (Settings, CrowdSec, or `CROWDSEC_ENABLED=true`), **Write log files** (Settings, Logs & monitoring) is on and locked, with the badge "Required by CrowdSec" ("Required by CROWDSEC_ENABLED" when the variable enables it). `LOGROTATE` is no longer needed for CrowdSec. When CrowdSec is turned off, the switch unlocks with the value you saved earlier. If that value is off, nginx keeps writing the log files until the next container restart (or until you save Write log files on and then off).

nginx writes `/opt/npmpro/nginx/logs/access.log` (and `error.log` and `stream.log`), rotated daily.

### 4. Create the acquisition file

The acquisition file tells CrowdSec which logs to read and starts the AppSec listener. Create `/opt/crowdsec/conf/acquis.d/npmpro.yaml` (create the `acquis.d` folder if it does not exist) with this content:

```yaml
filenames:
  - /opt/npmpro/nginx/logs/access.log
labels:
  type: npmplus
---
listen_addr: 0.0.0.0:7422
appsec_configs:
  - crowdsecurity/appsec-default
#  - crowdsecurity/crs # only if you installed crowdsecurity/appsec-crs
#  - crowdsecurity/appsec-bot-* # only if you set up bot detection, see below
name: appsec
source: appsec
labels:
  type: appsec
```

- The first part reads the access log. `type: npmplus` selects the parser of the collection; keep it exactly like this.
- The second part (after `---`) starts the AppSec listener on port 7422 inside the CrowdSec container. `0.0.0.0` is correct here: it is the address inside the container, and step 1 publishes the port on `127.0.0.1` of the host only.
- If you do not want AppSec, leave out everything from `---` on, and leave the AppSec URL empty in step 7.

### 5. Restart CrowdSec

```bash
docker restart crowdsec
docker logs crowdsec
```

The log should show that the file `/opt/npmpro/nginx/logs/access.log` is read and that the AppSec component listens on `0.0.0.0:7422`. Errors in the acquisition file are shown here too.

### 6. Create the bouncer key

```bash
docker exec crowdsec cscli bouncers add npmpro
```

The output contains an API key. Copy it now: it is shown only once. (If you lose it, run `docker exec crowdsec cscli bouncers delete npmpro` and add the bouncer again.)

### 7. Set up the bouncer in NPMpro

Open **Settings, CrowdSec** in NPMpro:

1. Turn on **Enable the bouncer**.
2. **LAPI URL**: the LAPI as NPMpro sees it. With the compose file above it is `http://127.0.0.1:8080`.
3. **API key**: the key from step 6.
4. **AppSec URL**: the AppSec listener from step 4, `http://127.0.0.1:7422`. New installs start with it empty (AppSec off); leave it empty if you did not set up AppSec.
5. Set **Admin UI and CrowdSec**: **Bans only** (recommended with AppSec) applies bans and captchas to the admin UI but not AppSec, so an AppSec outage cannot lock you out; **Left out** skips CrowdSec on the admin UI completely.
6. **Test connection**, then **Save**.

Saving checks the connection first: a wrong key or an unreachable LAPI or AppSec stops the save with the reason, and **Save anyway** saves all the same (for example while CrowdSec is not running yet). The settings apply at once with an nginx reload; NPMpro does not restart. The docker logs show `[Crowdsec] Initialisation done` after each save, and the startup log has a CrowdSec block with the state and a connection check.

**Test connection** checks the values in the form without saving: one decisions request to the LAPI with the key (or the TLS client certificate) and, with an AppSec URL, one request to AppSec. It names the problem: key refused, cannot be reached, TLS error or an unexpected answer. A key field left empty uses the saved key.

## Log format

NPMpro writes the access log (`access.log`) and the stream log (`stream.log`) in one line per request, or per stream session. The fields are separated by spaces. Text fields are in quotes. A value nginx does not have (for example the upstream status of a request without an upstream) is written as `-`, an empty one as nothing: the server port of a request over the internal unix socket is empty, and so is the quoted server name `""` of a request without a host name. The acquisition file of step 4 reads the access log. The parser of the collection, `ZoeyVid/npmplus-logs`, reads the fields up to the remote user (the time, host, client IP, request, status, referer, user agent and remote user); it does not read the fields after it, so it gives no port, TLS or cache values. The parser `TheBlackBush/npmpro-logs` reads all fields.

The new fields come at the end of each line, so a parser that reads the start of a line keeps working. The hub item `ZoeyVid/npmplus-logs` is such a parser.

The access log has these fields, in this order:

| Field | nginx variable | Example |
|---|---|---|
| Time | `[$time_local]` | `[26/Oct/2026:09:00:12 +0000]` |
| Host | `$host$is_request_port$request_port` | `app.example.com` |
| Client IP | `$remote_addr` | `192.168.2.30` |
| Request time (seconds) | `$request_time` | `0.113` |
| Request | `"$request"` | `"GET /api/items HTTP/2.0"` |
| Status | `$status` | `200` |
| Bytes sent | `$bytes_sent` | `4096` |
| Referer | `"$http_referer"` | `"https://app.example.com/"` |
| User agent | `"$http_user_agent"` | `"Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0"` |
| Remote user | `"$remote_user"` | `"-"` |
| Response content type | `"$sent_http_content_type"` | `"application/json"` |
| TLS protocol | `$ssl_protocol` | `TLSv1.3` |
| TLS cipher | `$ssl_cipher` | `TLS_AES_256_GCM_SHA384` |
| TLS curve | `$ssl_curve` | `X25519MLKEM768` |
| Cache status | `$upstream_cache_status` | `-` |
| Port | `$server_port` | `443` |
| Server name | `"$server_name"` | `"app.example.com"` |
| Host id | `$npmpro_host_id` | `proxy-3` |
| Request id | `$request_id` | `c07d5e1a92b84f36a8d4e0b7c15f2a98` |
| Connection | `$connection` | `41` |
| Upstream status | `"$upstream_status"` | `"502, 200"` |
| Upstream response time | `"$upstream_response_time"` | `"0.001, 0.112"` |

The last six fields (server name, host id, request id, connection, upstream status and upstream response time) are new.

The stream log has these fields, in this order:

| Field | nginx variable | Example |
|---|---|---|
| Time | `[$time_local]` | `[26/Oct/2026:09:05:44 +0000]` |
| Port | `$server_port` | `2222` |
| Client IP | `$remote_addr` | `203.0.113.9` |
| Protocol | `$protocol` | `TCP` |
| TLS protocol | `$ssl_preread_protocol` | `TLSv1.3` |
| Status | `$status` | `200` |
| Bytes sent | `$bytes_sent` | `1842` |
| Bytes received | `$bytes_received` | `512` |
| Session time (seconds) | `$session_time` | `12.304` |
| Stream id | `$npmpro_stream_id` | `stream-4` |

The stream id is new. It is `-` when the server does not set one.

### JSON log format and the NPMpro parser

Settings, Logs & monitoring has a Log format setting (`NGINX_LOG_FORMAT`): **Classic** (the default) or **JSON**. Both formats hold the same fields in the same order. JSON writes one object per line with the field names of the tables above as keys (`time_local`, `host`, `remote_addr`, `request_time`, `request`, `status`, `bytes_sent`, `http_referer`, `http_user_agent`, `remote_user`, `sent_http_content_type`, `ssl_protocol`, `ssl_cipher`, `ssl_curve`, `upstream_cache_status`, `server_port`, `server_name`, `host_id`, `request_id`, `connection`, `upstream_status`, `upstream_response_time`; in `stream.log`: `time_local`, `server_port`, `remote_addr`, `protocol`, `ssl_preread_protocol`, `status`, `bytes_sent`, `bytes_received`, `session_time`, `stream_id`). Every value is a string, and `""` when empty, including numbers such as `status` and `request_time`: use `tonumber` for comparisons. The exceptions are `host_id` and `stream_id`: they are `-` when no id is set (for example on a malformed request that nginx refuses itself), as in the classic format, so look for `"-"`, not `""`. The time is `$time_local` and the request is the one `$request` field, as in the classic format.

```sh
jq -r 'select(.status == "404") | .request' /opt/npmpro/nginx/logs/access.log
jq -r 'select(.host_id == "proxy-12") | [.time_local, .remote_addr, .status] | @tsv' /opt/npmpro/nginx/logs/access.log
jq -r 'select((.request_time|tonumber) > 1) | .request' /opt/npmpro/nginx/logs/access.log
```

The JSON format needs the parser `TheBlackBush/npmpro-logs` (in the collection `TheBlackBush/npmpro`). It is waiting for review in the CrowdSec hub ([hub#1961](https://github.com/crowdsecurity/hub/pull/1961)) and cannot be installed from the hub yet. The parser `ZoeyVid/npmplus-logs` of the default setup cannot read JSON lines. Until the NPMpro parser is on the hub, keep Log format on **Classic**.

Once it is on the hub, the acquisition of step 4 becomes this (the AppSec part stays as it is):

```yaml
filenames:
  - /opt/npmpro/nginx/logs/access.log
  - /opt/npmpro/nginx/logs/error.log
  - /opt/npmpro/nginx/logs/stream.log
  - /opt/npmpro/nginx/logs/tls.log
labels:
  type: npmpro
```

`tls.log` exists only with the TLS handshake log on; CrowdSec waits for a missing file.

The NPMpro parser reads the old and the new classic lines, JSON lines, and a file that switches from one format to the other. From the error log it reads only the rate-limit lines (`limiting requests, excess`), so `error.log` can be read without counting a failed basic auth twice: it counts once, from the 401 in the access log. From `tls.log` (the [TLS handshake log](#tls-handshake-log)) it reads only the handshake lines. The other error log lines show as "unparsed" in `cscli metrics`, which is expected.

The NPMpro collection also brings five scenarios:

| Scenario | Bans |
|---|---|
| `TheBlackBush/npmpro-bad-requests` | A client whose requests get repeated 400 answers, or 444 from the default site: more than 10 in quick succession from one IP (the count drops by one every 10 seconds). |
| `TheBlackBush/npmpro-stream-flood` | A client that opens more than 40 connections to one stream in quick succession (the count drops by one every second). |
| `TheBlackBush/npmpro-login-bf` | Failed sign-ins to the NPMpro admin UI on port 81 (401, 403 or 429 answers to the login): more than 5 from one IP (the count drops by one every 2 minutes). |
| `TheBlackBush/npmpro-tls-probe` | A client that fails the TLS handshake of the default site or the admin UI on purpose (rejected, old TLS version, no shared cipher, not TLS): more than 10 from one IP, HTTP/3 counted apart (the count drops by one every 30 seconds). Needs the [TLS handshake log](#tls-handshake-log). |
| `TheBlackBush/npmpro-stream-tls-probe` | A client whose connections to a TLS stream keep failing before the handshake ends (status 500): more than 15 to one stream (the count drops by one every 5 seconds), see [TLS streams](#tls-streams). |

### Host id

The host id names the NPMpro object that served a request. Its values:

| Host id | Meaning |
|---|---|
| `proxy-<id>` | A proxy host. `proxy-12` is the proxy host with id 12. |
| `redirection-<id>` | A redirection host. |
| `dead-<id>` | A 404 host. |
| `default` | The default site, also for the requests it closes without an answer (status 444). |
| `npmpro` | The admin UI. |
| `-` | A custom config, or a request that nginx refused before a host could handle it (for example a malformed request, status 400, or a request that timed out, status 408). |

The stream log has the stream id instead: `stream-<id>` for a stream, `-` otherwise.

The connection number ties a request to the error log. `$connection` is the number nginx gives the connection. An error log line of the same connection shows it as `*<number>`, so `*41` in the error log belongs to the connection `41` of the access log line above.

## TLS handshake log

Scanners such as nmap and testssl, and clients that try old TLS versions or weak ciphers, fail during the TLS handshake. nginx writes no access log line for them, and the error log (level `warn`) leaves them out. The setting **TLS handshake log** (Settings, Logs & monitoring, or `NGINX_TLS_HANDSHAKE_LOG=true`) writes them to `/data/nginx/logs/tls.log` (`/opt/npmpro/nginx/logs/tls.log` on the host) at level `info`, so the scenario `TheBlackBush/npmpro-tls-probe` can ban them. It is off by default and needs the log files: Write log files on, or CrowdSec enabled, which keeps them on. While the log files are off, nothing is written.

The file holds the handshakes that end in the default site (HTTPS and HTTP/3) and in the admin UI:

- rejected handshakes: no host name (SNI) or one that is not yours, on a default site set to No Response (444). The admin UI port does not reject them: it answers with its certificate, so they are not in the file;
- old TLS versions (1.0 and 1.1), no shared cipher or signature algorithm, an ALPN protocol NPMpro does not offer;
- plain HTTP sent to the HTTPS port without the name of one of your hosts, and data that starts like a TLS record but is not one (other random bytes are logged as `client sent invalid method` and not counted);
- connections closed during the handshake (`peer closed connection`, `client closed connection`): written, never counted, since health checks and browsers do this too.

Rejected handshakes need the default site **No Response (444)** (Settings, Landing pages). With any other default site, nginx answers a client without a host name, or with an unknown one, with the default certificate, and nothing is logged; failures of the TLS version or cipher are still logged.

With the PROXY protocol on the HTTPS port (`LISTEN_PROXY_PROTOCOL_HTTPS=true`, also set by `LISTEN_PROXY_PROTOCOL=true`), the setting stays off and shows "Off because of LISTEN_PROXY_PROTOCOL_HTTPS", also when `NGINX_TLS_HANDSHAKE_LOG=true` is set. nginx writes a failed handshake before it reads the client address from the PROXY header, so every line would name the load balancer in front of NPMpro, and a scan through it would ban the balancer and with it every client behind it.

Not in the file: a failed handshake that names one of your hosts (for example TLS 1.0 sent to `app.example.com`) is handled by that host and only reaches the error log at level `warn`, which leaves it out. TLS streams are covered by the stream log, see [TLS streams](#tls-streams).

The default site and the admin UI keep writing their errors to `error.log` and to the Docker logs. While the setting is on, `tls.log` also holds those errors and the other `info` lines of these two (for example closed keep-alive connections or client header errors). The NPMpro parser reads only the handshake lines from `tls.log`, and counts a rate-limit line from `error.log` only. If you added an `error_log` of your own at the main level in a custom nginx file, these two servers do not repeat it while the setting is on: their errors go to the standard places (Docker logs and `error.log`) and to `tls.log`.

`tls.log` needs the parser `TheBlackBush/npmpro-logs`; `ZoeyVid/npmplus-logs` cannot read it. Add the file to the `type: npmpro` acquisition of [JSON log format and the NPMpro parser](#json-log-format-and-the-npmpro-parser):

```yaml
filenames:
  - /opt/npmpro/nginx/logs/access.log
  - /opt/npmpro/nginx/logs/error.log
  - /opt/npmpro/nginx/logs/stream.log
  - /opt/npmpro/nginx/logs/tls.log
labels:
  type: npmpro
```

To check it: turn the setting on, set the default site to No Response (444), and from a second device run `openssl s_client -connect <NPMpro IP>:443 -noservername </dev/null` eleven times (a probe without a host name). An OpenSSL 3 client refuses `-tls1_1` on its own unless you add `-cipher ALL:@SECLEVEL=0`, so it does not make a good test. `docker exec crowdsec cscli decisions list` then shows a ban for `TheBlackBush/npmpro-tls-probe`; remove it with `docker exec crowdsec cscli decisions delete --ip <IP>`.

### Ban length

CrowdSec sets how long a ban lasts in its profiles, not in the scenario: the default profile bans for 4 hours. To ban TLS probes for 5 minutes (both TLS scenarios: a stream health check that trips the stream one should not lock a client out for 4 hours), add this profile at the top of `/opt/crowdsec/conf/profiles.yaml` (profiles are separated by `---`, and the first profile that applies with `on_success: break` ends the evaluation, so it must come before the default one) and restart CrowdSec:

```yaml
name: npmpro_tls_probe
filters:
  - Alert.Remediation == true && Alert.GetScope() == "Ip" && Alert.GetScenario() in ["TheBlackBush/npmpro-tls-probe", "TheBlackBush/npmpro-stream-tls-probe"]
decisions:
  - type: ban
    duration: 5m
on_success: break
---
```

### TLS streams

A stream with a certificate writes status 500 to `stream.log` when the TLS handshake fails or the client leaves before it ends; a failure of the upstream is 502. `TheBlackBush/npmpro-stream-tls-probe` counts the 500 lines per IP and stream: more than 15 in quick succession ban the IP (the count drops by one every 5 seconds). It needs no setting, only `stream.log` in the acquisition. A TCP health check of a TLS stream also ends with status 500: one check every 5 seconds or less often from one IP never triggers it; add a faster one to a CrowdSec allowlist (`cscli allowlists`, see [Locked out of the admin UI](#locked-out-of-the-admin-ui)).

### False bans

A TLS ban can hit clients that are not scanners: a shared IP (mobile networks, company NAT) with one old device, old devices that retry TLS 1.0 or 1.1, company TLS inspection proxies without TLS 1.2 ECDHE ciphers, and uptime monitors or your own `curl https://<IP>` that connect without a host name to a default site set to 444. Allow such IPs (`crowdsecurity/whitelists` already covers private ranges, or a CrowdSec allowlist, see [Locked out of the admin UI](#locked-out-of-the-admin-ui)), and keep the 5 minute profile above.

## What each setting means

NPMpro writes `/data/crowdsec/crowdsec.conf` (`/opt/npmpro/crowdsec/crowdsec.conf` on the host) from Settings, CrowdSec at every save and at every start. Hand edits of that file are overwritten, so change the settings in the web UI. `ban.html` and `captcha.html` in the same folder stay yours to edit; they are loaded again at the next save (the **Preview** links in the Advanced part show them). A `crowdsec.conf.local` overrides the settings and is not wanted anymore: remove it (the upgrade keeps your old one as `crowdsec.conf.local.before-settings`).

| Setting | Key in the file | Default | Meaning |
|---|---|---|---|
| Enable the bouncer | `ENABLED` | off | checks every request; applies on save |
| LAPI URL | `API_URL` | `http://127.0.0.1:8080` | the CrowdSec LAPI |
| API key | `API_KEY` | empty | the bouncer key from `cscli bouncers add`. Stored encrypted and never shown again; an empty field keeps the saved key, **Remove the saved key** deletes it |
| Authentication: TLS client certificate, client certificate file, client key file | `USE_TLS_AUTH`, `TLS_CLIENT_CERT`, `TLS_CLIENT_KEY` | key, no files | authenticate with a TLS client certificate instead of the API key; needs an `https://` LAPI URL, and both files must be under `/data/crowdsec/` and be unencrypted PEM files (see [TLS client authentication and AppSec](#tls-client-authentication-and-appsec)) |
| Verify TLS certificates | `SSL_VERIFY` | on | check the certificate of an `https://` LAPI or AppSec URL |
| Mode | `MODE` | live | live asks the LAPI per client IP and caches the answer for **Cache answers for** seconds (`CACHE_EXPIRATION`, default 1). Stream downloads all decisions every **Update every** seconds (`UPDATE_FREQUENCY`, default 10) and answers from memory |
| LAPI request timeout (Advanced) | `REQUEST_TIMEOUT` | 3000 | timeout for LAPI requests in milliseconds |
| Decision types | `BOUNCING_ON_TYPE` | all | which decision types are enforced: all, ban only or captcha only |
| Fallback remediation | `FALLBACK_REMEDIATION` | ban | what to do with a decision type the bouncer does not know: ban or captcha |
| Only scenarios containing, Ignore scenarios containing (Advanced) | `SCENARIOS_CONTAINING`, `SCENARIOS_NOT_CONTAINING` | empty | only enforce (or ignore) decisions whose scenario contains one of these comma-separated strings |
| Excluded paths (Advanced) | `EXCLUDE_LOCATION` | empty | comma-separated paths that are never checked, each starting with `/` |
| Check internal requests (Advanced) | `ENABLE_INTERNAL` | off | also check internal requests (for example after a rewrite) |
| Answer to a ban | `BAN_TEMPLATE_PATH`, `REDIRECT_LOCATION`, `RET_CODE` | ban page | **Ban page** shows the ban page of Landing pages (with an optional status code, 403 by default), **Redirect** sends banned visitors to a URL or a path of the same host, **Status code only** answers with a status code and no page. The choice decides which of the three keys are written |
| Ban page, Captcha page | `BAN_TEMPLATE_PATH`, `CAPTCHA_TEMPLATE_PATH` | set by NPMpro | chosen in Settings, Landing pages (the NPMpro pages or a custom page, see [Landing pages](Landing-pages)); NPMpro writes the two keys itself. The files `/data/crowdsec/ban.html` and `captcha.html` are no longer read |
| Captcha: Provider, Site key, Secret key | `CAPTCHA_PROVIDER`, `SITE_KEY`, `SECRET_KEY` | none | the captcha for decisions of type `captcha`: reCAPTCHA, hCaptcha or Cloudflare Turnstile, with the keys from that provider. The secret key is stored encrypted and never shown again |
| A solved captcha is valid for | `CAPTCHA_EXPIRATION` | 3600 | seconds a solved captcha stays valid |
| AppSec URL | `APPSEC_URL` | empty on new installs | the AppSec listener; empty turns AppSec off |
| When AppSec cannot be reached | `APPSEC_FAILURE_ACTION` | deny | **Deny the request** blocks every checked request while AppSec is down (every host, and the admin UI and with it the container health check unless the admin UI is on Bans only or Left out), **Let the request through** leaves them unchecked |
| AppSec connect, send and process timeout (Advanced) | `APPSEC_CONNECT_TIMEOUT`, `APPSEC_SEND_TIMEOUT`, `APPSEC_PROCESS_TIMEOUT` | empty | in milliseconds (empty: the defaults of the bouncer) |
| Always send to AppSec (Advanced) | `ALWAYS_SEND_TO_APPSEC` | off | also send requests of IPs that already have a decision to AppSec |
| Drop requests with an unreadable body (Advanced) | `APPSEC_DROP_UNREADABLE_BODY` | on | drop requests whose body cannot be read (HTTP/2 or HTTP/3 requests without a content-length header, or gRPC requests) instead of sending them to AppSec without a body |
| Admin UI and CrowdSec | not a bouncer key | Checked like every host | **Checked like every host**: bans, captchas and AppSec; **Bans only**: bans and captchas, no AppSec; **Left out**: no check at all |

The `CACHE_SIZE`, `STREAM_REQUEST_TIMEOUT` and `CAPTCHA_RET_CODE` keys of the bouncer have no setting.

### Admin UI and CrowdSec

The admin UI port (`NPM_PORT`, 81 by default) has three choices:

| Choice | What NPMpro writes for the admin UI |
| --- | --- |
| Checked like every host | The bouncer (bans and captchas) and AppSec, as for every host. |
| Bans only | The bouncer, without AppSec. |
| Left out | Nothing: no bouncer and no AppSec. |

The ban check fails open. In live mode, when the LAPI does not answer, the bouncer lets the request through after up to **LAPI request timeout**, and then remembers "no decision" for that client IP for **Cache answers for** seconds before it asks again. Stream mode answers from the decisions it holds. So **Bans only** keeps the admin UI reachable while CrowdSec is down, and in live mode an IP waits for an unreachable LAPI at most once per **Cache answers for** period (a ban added in that time applies after it, at the latest).

The container health check makes one request every 30 seconds. With **Cache answers for** below 30 seconds, each check still waits up to **LAPI request timeout** once. In live mode with **Bans only**, keep **LAPI request timeout** under 10 seconds (10000 ms; Docker's health check timeout), raise **Cache answers for**, or use stream mode.

`TheBlackBush/npmpro-login-bf` bans an IP after failed sign-ins on any `NPM_PORT`. With **Bans only** (or **Checked like every host**) that ban now also closes the admin UI to that IP. See [Locked out of the admin UI](#locked-out-of-the-admin-ui).

The ban and captcha pages on the admin UI look as on every host, and the captcha can be solved there. The captcha page allows only the provider set in Captcha: Provider; with no provider set, a captcha decision shows the ban page, because the bouncer falls back to **Fallback remediation** (ban by default). The admin UI's own pages keep their strict content security policy.

Mind one case: if you moved the admin UI to port 80 or 443 with `NPM_PORT`, requests with an unknown Host header land in the admin server too. With **Bans only** they skip AppSec, with **Left out** they skip all of CrowdSec. Keep the admin UI on its own port if that matters to you.

### TLS client authentication and AppSec

AppSec authenticates with the API key, not with the TLS client certificate. With **TLS client certificate** as the authentication, the **API key** field therefore appears as soon as an **AppSec URL** is filled in, and it is required then (create the key with `cscli bouncers add`; the LAPI still uses the certificate). Without a key AppSec answers every request with 401: with **Deny the request** every checked request on every host is refused, with **Let the request through** AppSec silently checks nothing. Settings, CrowdSec therefore refuses to save an AppSec URL without a key. Settings that did not come through a save (a restore of a backup without secrets, an import, `CROWDSEC_APPSEC_URL`) can still have an AppSec URL without a key: then NPMpro keeps the bouncer off, so nothing is blocked (and nothing is checked). The stored settings stay as they are; the docker logs say `CrowdSec: AppSec has no API key, the bouncer stays off until the key is entered`, the startup block says "CrowdSec: off (AppSec has no API key, ...)" and Settings, CrowdSec shows a warning. Enter the API key in Settings, CrowdSec and save (or clear the AppSec URL), and the bouncer is on again.

### Environment variables

These variables win over Settings, CrowdSec and lock their field there: `CROWDSEC_ENABLED` (`true` or `false`), `CROWDSEC_LAPI_URL`, `CROWDSEC_API_KEY`, `CROWDSEC_APPSEC_URL`. A value NPMpro cannot use (not `true`/`false`, not an http or https URL) is ignored and named in the startup log. A variable set to an empty value counts as unset: `CROWDSEC_APPSEC_URL=""` does not lock AppSec off, and the field stays editable. The other settings have no variable. See [Configuration](Configuration).

### If the bouncer file is broken

If `crowdsec.conf` is missing or cannot be read, or a TLS client certificate or key does not parse, NPMpro does not stop nginx: nginx starts with the bouncer off, with a line in the docker logs (`CrowdSec: ... the bouncer stays off until it is fixed`). A missing `crowdsec.conf` needs nothing from you: the backend writes it again from the settings at the same start and loads the bouncer, so the startup block says "CrowdSec: on". A TLS client certificate or key that is not set, missing or does not parse keeps the bouncer off: the startup block says "CrowdSec: off" and Settings, CrowdSec shows a warning naming the files. The stored settings stay as they are, and the bouncer comes back once the file is fixed (put the file back, then save the settings or restart NPMpro). A missing ban or captcha page is only a warning: the bouncer runs without that page.

### Captcha instead of a ban

The bouncer supports the captcha remediation. In Settings, CrowdSec choose the captcha **Provider** and enter the site key and secret key from reCAPTCHA, hCaptcha or Cloudflare Turnstile, then save. Decisions of type `captcha` show the captcha page instead of the ban page. Scenarios ban by default; a captcha decision comes from a CrowdSec profile that you change, or from `cscli decisions add --type captcha`. See the CrowdSec documentation on profiles.

## Check that it works

1. **The log is read:**
   ```bash
   docker exec crowdsec cscli metrics
   ```
   The acquisition table should list `/opt/npmpro/nginx/logs/access.log` with a growing number of lines read and parsed. "Lines parsed" should be close to "Lines read". If "Lines unparsed" grows instead, the parser is outdated: run the hub update of step 2 again. If the file is missing from the table or nothing is parsed at all, check the `type` in the acquisition file.
2. **The bouncer is connected:**
   ```bash
   docker exec crowdsec cscli bouncers list
   ```
   The `npmpro` bouncer should show a recent last pull. In `live` mode it first appears after a request has reached one of your hosts.
3. **A test ban:** find the public IP of a second device, for example a phone on mobile data, and ban it for 5 minutes:
   ```bash
   docker exec crowdsec cscli decisions add --ip 203.0.113.7 --duration 5m --reason "test ban"
   ```
   Open one of your hosts on that device: it shows the ban page. Remove the ban with:
   ```bash
   docker exec crowdsec cscli decisions delete --ip 203.0.113.7
   ```
   Do not ban the IP you manage the server from: the bouncer also protects the web UI port, so you would lock yourself out until the ban expires or you delete it with `cscli`.
4. **Optional, a real ban:** from the second device, request about 20 paths that do not exist on a 404 host of yours (for example `https://unused.example.com/test1` to `/test20`). This triggers the scenario `crowdsecurity/http-probing` and CrowdSec bans the device's IP (it shows up in `cscli decisions list` with that reason, and the device then gets the ban page). Delete the ban afterwards:
   ```bash
   docker exec crowdsec cscli decisions delete --ip 203.0.113.7
   ```
5. **The current bans:**
   ```bash
   docker exec crowdsec cscli decisions list
   ```
6. **In the web UI:** the Monitoring page (administrators) has a **CrowdSec** tab whenever Monitoring is available, that is while traffic statistics are on or the bouncer is configured. Without a configured bouncer the tab says "CrowdSec is not configured". Once the bouncer is enabled with a key, Monitoring appears in the menu even with traffic statistics off, the tab shows the bans and the dashboard shows an **Active bans** card. The tab lists the active bans (total, added in the last 24 hours, by reason, origin and type, a map and the newest bans) and the connection state. NPMpro reads the bans with the key from Settings, CrowdSec and polls the LAPI every 60 seconds, so a new ban can take up to a minute to appear. It is read-only and shows no alerts. See [Monitoring](Monitoring).
7. **AppSec:** request a path that a virtual patch blocks on one of your proxy hosts, for example `https://app.example.com/.env` (a 404 host does not block it). With AppSec working the answer is 403 from NPMpro, and `docker exec crowdsec cscli metrics` shows the request in the AppSec tables. Repeated hits like this can get your IP banned, so test from the second device or delete the decision afterwards.

## AppSec and your hosts

- **Request bodies are always buffered** on hosts and locations where AppSec is active, because AppSec needs the whole body. Turning on Disable Request Buffering therefore also turns on Disable Crowdsec Appsec for that host or location, and turning Disable Crowdsec Appsec off turns Disable Request Buffering off again. Response buffering is not affected.
- **AppSec blocks request bodies bigger than 10 MiB** by default. For hosts that receive bigger uploads (Nextcloud, photo libraries, backup targets) turn on **Disable Crowdsec Appsec**.
- **Where the option is:** in the proxy host dialog on the **Details** tab, under **Options**, the switch **Disable Crowdsec Appsec**. Each custom location has its own switch: open the location on the **Custom Locations** tab, its **Options** have the same switch. A custom location does not take over the switch of the host.
- The switch only turns off AppSec. Bans from the LAPI still apply to the host.
- Without an AppSec URL the switch does nothing.
- **The request id and the HTTP version.** With AppSec on, the request that the bouncer sends to the AppSec carries three more headers. NPMpro sets them for that request only, and the upstream receives the request as before. `X-Npmpro-Request-Id` is also removed from every request NPMpro passes on (proxy hosts, custom locations, gRPC, PHP, forward authentication and the admin UI), so no upstream receives it, not even a value the client sent. A client that sends one of these three headers has its value replaced in that request. Every other client header reaches the AppSec unchanged: a client's own `X-Request-Id` reaches the AppSec, where the rules inspect it like any other header, and the upstream, both with the client's value.
  - `X-Crowdsec-Appsec-Transaction-Id` carries the request's `$request_id`, the `request_id` field of the access log. CrowdSec uses the transaction id as the id of the AppSec request (`request_uuid`, `tx_id`).
  - `X-Npmpro-Request-Id` carries the same id as a normal request header: CrowdSec does not pass its own `X-Crowdsec-Appsec-*` headers to the alert context, but it passes this one, so the alert context below can put the id into the alert.
  - `X-Crowdsec-Appsec-Http-Version` carries the client's HTTP version (`10`, `11`, `20` or `30`). The AppSec rules see the client's HTTP version and not the bouncer's own, which may change which rules match a request over HTTP/2 or HTTP/3.
- **Your own proxy configs.** A `proxy_pass`, `grpc_pass` or `fastcgi_pass` of your own in a custom config (`/opt/npmpro/custom_nginx/`) or in the advanced config of a host does not include NPMpro's header files. Add `proxy_set_header X-Npmpro-Request-Id "";` (for `grpc_pass`: `grpc_set_header X-Npmpro-Request-Id "";`, for `fastcgi_pass`: `fastcgi_param HTTP_X_NPMPRO_REQUEST_ID "" if_not_empty;`) there, so a client cannot send that header through it.

### Find the request of an AppSec event

An alert raised by the AppSec carries the request id of the blocked request as `request_id` in its context, the `request_id` field of the access log line. It needs CrowdSec 1.6.4 or newer and the alert context `TheBlackBush/npmpro`. Check your version first (`docker exec crowdsec cscli version`): CrowdSec 1.6.3 and older refuse to start with this context (`unknown name req`), and with **When AppSec cannot be reached** on **Deny the request** a stopped CrowdSec blocks every checked request. Update CrowdSec before you add the context or install the collection. That context is part of the collection `TheBlackBush/npmpro`, which waits for review in the CrowdSec hub ([hub#1961](https://github.com/crowdsecurity/hub/pull/1961)); until then, and with any other collection (for example with `ZoeyVid/npmplus`), add it by hand: create `contexts/npmpro.yaml` in CrowdSec's config folder (`/etc/crowdsec/contexts/npmpro.yaml` in the container, `/opt/crowdsec/conf/contexts/npmpro.yaml` on the host) with

```yaml
context:
  request_id:
    - "req.Method != '' ? req.Header.Get('X-Npmpro-Request-Id') : ''"
```

and restart CrowdSec (`docker restart crowdsec`). Once you install the collection `TheBlackBush/npmpro`, delete this file and restart CrowdSec again: the collection brings the same context, and a hand-made file with the same name can keep the hub version from being installed. Then:

```bash
docker exec crowdsec cscli alerts list
docker exec crowdsec cscli alerts inspect -d <alert id>
grep <request_id> /opt/npmpro/nginx/logs/access.log
```

`cscli alerts inspect -d` shows `request_id` in the Context table; `cscli alerts list -o json` has it in the alert's `meta` list, as a list of one id in a string (`{"key":"request_id","value":"[\"<id>\"]"}`). Alerts of the log scenarios (failed sign-ins, scans, bad requests) count many requests, so their Context has no `request_id`; each event inside such an alert still carries the `request_id` of its own access log line (`cscli alerts inspect -d` lists the events). Without the context, or for requests older than this NPMpro version, search the access log for the client IP and the URI around the time of the alert:

```bash
grep '<client IP>' /opt/npmpro/nginx/logs/access.log | grep '<URI>'
```

Without the alert context, the AppSec log of CrowdSec carries the id at the debug level only: with `log_level: debug` in the AppSec part of the acquisition file (step 4), each request the AppSec checks logs `request_uuid=<id>` (and the rule engine logs `tx_id=<id>`), and that id is the `request_id` of the access log line. Debug logging is verbose, so turn it on only while you look for a request:

```bash
docker logs crowdsec 2>&1 | grep request_uuid
grep <request_uuid> /opt/npmpro/nginx/logs/access.log
```

## Access lists and forward authentication

The bouncer runs before access lists and forward authentication. A banned IP gets the ban page instead of a password prompt, so it cannot keep guessing passwords, and an access list with **Satisfy Any** no longer lets a banned IP through with valid credentials or an allowed address. This has some side effects:

- **Uploads to protected hosts:** with AppSec on, request bodies to hosts behind an access list or forward authentication are read and sent to AppSec before the client has signed in. Set a `client_max_body_size` in the advanced config of such hosts, or turn on **Disable Crowdsec Appsec** there, if that matters to you.
- **Clients let in by an IP rule:** clients allowed by an IP rule of an access list with **Satisfy Any** are checked by CrowdSec too, including the bot detection challenge. Apps in your LAN that are not browsers may need a CrowdSec allowlist entry, or Disable Crowdsec Appsec on that host (which also turns off bot detection there).
- **LDAP:** `auth_ldap` from the advanced config still runs before the bouncer.
- **Custom Lua:** your own `access_by_lua` blocks in the advanced config run before allow/deny rules, basic auth and forward authentication while CrowdSec is enabled. They must not set `access_by_lua_no_postpone` themselves.

## Bot detection (optional)

Bot detection challenges every request without a valid cookie, so clients that cannot solve the challenge, such as mobile apps or API clients, are blocked. Use it only for hosts that are opened in a browser. Full documentation: https://doc.crowdsec.net/docs/next/appsec/bot_detection/enable. The short version:

1. Add `crowdsecurity/appsec-bot-challenge`, `crowdsecurity/appsec-bot-challenge-strict` or `crowdsecurity/appsec-bot-challenge-permissive` to the `COLLECTIONS` variable of the CrowdSec container, depending on the threshold you want, and run `docker compose up -d crowdsec`.
2. Uncomment `crowdsecurity/appsec-bot-*` in the acquisition file from step 4. The wildcard only matches the AppSec configs you actually installed.
3. Restart CrowdSec: `docker restart crowdsec`.

For hosts used by apps, turn on Disable Crowdsec Appsec (this also turns off bot detection there).

## Rate limiting (optional)

If you added rate limiting (`limit_req_zone`/`limit_req`) through the advanced config of a host or `/opt/npmpro/custom_nginx`, the scenario `crowdsecurity/nginx-req-limit-exceeded` from the collection can ban clients that exceed it. nginx writes the `limiting requests, excess` lines only to the error log, so add it to the first part of the acquisition file:

```yaml
filenames:
  - /opt/npmpro/nginx/logs/access.log
  - /opt/npmpro/nginx/logs/error.log
labels:
  type: npmplus
```

Then restart CrowdSec. nginx writes the client IP itself, so bans cannot be forged. The request line however is written as the client sent it: a crafted one can put any value into `target_fqdn`, so do not build whitelists on the domain of an error log alert. With the error log added, failed basic auth attempts show up in both logs, so `crowdsecurity/http-generic-bf` counts each of them twice and bans after roughly half as many failed attempts (3 instead of 6 in quick succession). With the NPMpro parser ([JSON log format and the NPMpro parser](#json-log-format-and-the-npmpro-parser)) the double counting is gone.

## Firewall bouncer

The nginx bouncer blocks banned IPs at the HTTP level: nginx still accepts their connections and the TLS handshake. It is better to block as early as possible, so if you can, also install a firewall bouncer on the host: https://docs.crowdsec.net/u/bouncers/firewall. It drops the packets of banned IPs before they reach nginx, and it covers streams and other services too. Include the Docker iptables chains in its config (the `DOCKER-USER` chain), otherwise ports published by other containers are not covered. The nginx bouncer stays useful next to it for AppSec.

## Privacy

Unless you [turn off sharing](https://docs.crowdsec.net/docs/next/configuration/crowdsec_configuration/#sharing) in CrowdSec, the engine sends signals about detected attacks (including the attacking IPs and [this metadata](https://docs.crowdsec.net/docs/central_api/intro/#signal-meta-data)) to CrowdSec, and receives the community blocklist in return. Mention it in your privacy policy, see [Hints for Your Privacy Policy](Privacy). With `crowdsecurity/http-extended-context` and an enrolled engine, the attacked domain is sent too. With context sharing on (`cscli console status`, option `context`; `cscli console enroll` turns it on unless you pass `--disable context`), the alert context is sent with each alert too, and with it the request id of AppSec alerts. The id is random and only points to a line of your own access log; `cscli console disable context` keeps the context local. The TLS handshake log holds the IP of every client whose handshake failed or was rejected on the default site and the admin UI, also of clients that never reached a host.

## Troubleshooting

### Every host answers with 403

- **AppSec is configured but not reachable.** The AppSec URL is set while the AppSec listener does not run (the acquisition file has no AppSec part, CrowdSec is stopped, or the port is not published), and the failure action **Deny the request** blocks everything. Check `docker logs crowdsec` for the AppSec listener, check that `127.0.0.1:7422` is published, or clear the AppSec URL in Settings, CrowdSec (a locked field: remove `CROWDSEC_APPSEC_URL` first). **Let the request through** (`APPSEC_FAILURE_ACTION=passthrough`) lets requests through while AppSec is down, at the cost of no protection in that time. If the admin UI is blocked too, see [Locked out of the admin UI](#locked-out-of-the-admin-ui).
- **Your own IP has a ban or captcha decision.** Run `docker exec crowdsec cscli decisions list` and delete the decision with `cscli decisions delete --ip <ip>`. A decision from a blocklist comes back with the next pull, so also add the IP to an allowlist, see [Locked out of the admin UI](#locked-out-of-the-admin-ui). If CrowdSec bans the IP of a proxy in front of NPMpro, set Trusted proxy IPs (see [Requirements](#requirements)).
- **Uploads fail with 403** on a host that receives big files: turn on Disable Crowdsec Appsec for it (see [AppSec and your hosts](#appsec-and-your-hosts)).

### The bouncer does not connect

- Open **Settings, CrowdSec** and click **Test connection**. The check names the problem: key refused, cannot be reached, a TLS error or an unexpected answer, for the LAPI and for AppSec. The Status part shows whether nginx loaded the bouncer and when NPMpro last reached the LAPI.
- Look into `docker logs npmpro` for lines starting with `[Crowdsec]` and the CrowdSec block of the startup log. No `[Crowdsec] Initialisation done` after a save means nginx did not load the bouncer: the save shows the answer of nginx, the `[Crowdsec]` error lines say why, and the Status part shows whether the bouncer is loaded. The CrowdSec block is printed only when the container starts.
- The LAPI URL must be reachable from NPMpro. With `network_mode: host` and the compose file above that is `http://127.0.0.1:8080`. Test it from the host with `curl http://127.0.0.1:8080/v1/decisions -H "X-Api-Key: <key>"`: a working key returns `null` or a list, a wrong key returns 403.
- A wrong or deleted key: create a new one (step 6), enter it in Settings, CrowdSec and save.
- A field that is greyed out is locked by an environment variable (see [Environment variables](#environment-variables)).
- "Save anyway" is not offered when it would lock you out: AppSec fails, **When AppSec cannot be reached** is **Deny the request** and the admin UI is on Checked like every host. There are three ways out: fix the API key or the AppSec URL, set the failure action to **Let the request through**, or choose **Bans only** or **Left out** for **Admin UI and CrowdSec**. The last one only protects the admin UI: your hosts are still blocked while AppSec fails with deny, so fix AppSec or the failure action as well.

### Locked out of the admin UI

Your own IP has a ban or captcha decision: with **Checked like every host** or **Bans only**, a ban closes the admin UI to that IP too, and so does a captcha that cannot be solved (for example with wrong captcha keys). Run `docker exec crowdsec cscli decisions list`, then `docker exec crowdsec cscli decisions delete --ip <your IP>`; the admin UI opens again within **Cache answers for** (live mode) or **Update every** (stream mode).

That removes the decision for now. A decision from a blocklist (the community blocklist or a list you subscribed to in the CrowdSec console) comes back with the next pull. For a lasting exception, add your IP to an allowlist (CrowdSec 1.6.6 or newer) and then delete the decision as above:

```sh
docker exec crowdsec cscli allowlists create npmpro-admins -d "admin IPs"
docker exec crowdsec cscli allowlists add npmpro-admins <your IP>
```

CrowdSec then keeps that IP out of local decisions, blocklist pulls and AppSec blocks. On an older CrowdSec use a whitelist parser instead (https://docs.crowdsec.net/docs/log_processor/whitelist/intro/).

Without access to CrowdSec, set `CROWDSEC_ENABLED=false` on the NPMpro container and recreate it. Then, in Settings, CrowdSec, choose **Left out** for **Admin UI and CrowdSec** (or remove the decision or allowlist the IP as above), remove the variable and recreate the container again.

AppSec fails and locks you out when AppSec is set to deny and the admin UI is on **Checked like every host**. AppSec fails when CrowdSec is down, or when AppSec refuses the key (for example the bouncer was deleted with `cscli bouncers delete`). A missing key does not lock you out: NPMpro keeps the bouncer off until the key is entered (see [TLS client authentication and AppSec](#tls-client-authentication-and-appsec)). If CrowdSec is down, start it again; the admin UI works again at once. If the key is refused or that is not possible, set `CROWDSEC_ENABLED=false` on the NPMpro container and recreate it, then choose **Bans only** or **Left out** for **Admin UI and CrowdSec** (this restores only the admin UI, not your hosts) and set the failure action to **Let the request through** or fix AppSec, fix the settings and remove the variable. A bouncer config nginx rejects (for example a TLS client file that was deleted) never stops NPMpro from starting: the bouncer stays off and the startup log says why, see [If the bouncer file is broken](#if-the-bouncer-file-is-broken).

### The CrowdSec tab says "CrowdSec is not configured"

The tab needs the bouncer enabled and a LAPI URL and an API key (or TLS client authentication with a certificate and key) in Settings, CrowdSec. "CrowdSec could not be reached" means the settings are fine but the LAPI did not answer; NPMpro tries again every minute and shows the reason.

### No alerts and no bans

- Check that Write log files is on (CrowdSec turns it on by itself) and `/opt/npmpro/nginx/logs/access.log` grows.
- Check that the CrowdSec container mounts the log folder (step 1) and that `cscli metrics` shows the file with parsed lines.
- "Lines unparsed" grows while "Lines parsed" stays at 0 or low: the parser is outdated. Run `docker exec crowdsec cscli hub update`, `docker exec crowdsec cscli hub upgrade` and `docker restart crowdsec` (step 2).
- Normal traffic does not create bans. Use the test ban above to check the bouncer.

### Logs

- NPMpro and the bouncer: `docker logs npmpro` (the nginx error log is always written there, and to `/opt/npmpro/nginx/logs/error.log` with Write log files on).
- CrowdSec: `docker logs crowdsec`, `docker exec crowdsec cscli metrics`, `docker exec crowdsec cscli alerts list`.

For the full picture of alerts, decisions and metrics, the companion project [CrowdSec Web UI](https://github.com/TheDuffman85/crowdsec-web-ui) is recommended.
