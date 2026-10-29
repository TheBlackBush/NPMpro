# CrowdSec

CrowdSec blocks IPs that attack your hosts. With NPMpro it works in two parts:

- **The CrowdSec engine** (the Security Engine with its Local API, "LAPI") runs in its own container. It reads the NPMpro access log, detects attacks with scenarios (scans, brute force, known exploits) and decides which IPs to ban.
- **The bouncer** is built into NPMpro: a Lua module in nginx asks the LAPI about every client IP and answers banned IPs with a ban page (HTTP 403) instead of forwarding the request.
- **AppSec** (optional, but part of the default setup below) is the web application firewall of CrowdSec. The bouncer sends each request to the AppSec listener of the engine, which blocks requests that match known attacks (for example virtual patches for known CVEs) before they reach your service.

The bouncer covers all HTTP traffic of nginx: proxy hosts, redirection hosts, 404 hosts, the default site and the web UI port. Streams (TCP/UDP) are not covered; use a firewall bouncer for them (see [Firewall bouncer](#firewall-bouncer)).

The paths below assume the default volumes: NPMpro data in `/opt/npmpro` and CrowdSec in `/opt/crowdsec` on the host. If you use other host paths, change them everywhere.

## Requirements

- NPMpro with `network_mode: host` (the default in `compose.yaml`). Then nginx sees the real client IPs and reaches the CrowdSec ports on `127.0.0.1`. Without host networking, the LAPI and AppSec ports must be reachable from inside the NPMpro container and you have to change `API_URL` and `APPSEC_URL` in step 8 to match.
- If NPMpro sits behind another proxy, CDN or tunnel, set up Trusted proxy IPs (or Trust Cloudflare) first, see [Troubleshooting](Troubleshooting#the-logs-show-the-wrong-client-ips). Otherwise CrowdSec bans the IP of that proxy.
- Write log files turned on (step 3): CrowdSec reads `access.log` from the NPMpro data folder.
- The host ports 8080 (LAPI) and 7422 (AppSec) free on `127.0.0.1`. If something else uses 8080 there, for example NPMpro itself with `HTTP_PORT=8080`, publish the LAPI on another host port and use that port in `API_URL`.

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

### 3. Turn on Write log files

In the NPMpro web UI open Settings, Logs & monitoring and turn on **Write log files**, then save. It applies on save. Or set `LOGROTATE=true` in the `npmpro` service and run `docker compose up -d`.

nginx then writes `/opt/npmpro/nginx/logs/access.log` (and `error.log` and `stream.log`), rotated daily.

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
- If you do not want AppSec, leave out everything from `---` on, and clear `APPSEC_URL` in step 8.

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

### 7. Open the bouncer config

NPMpro creates the bouncer config at its first start: `/opt/npmpro/crowdsec/crowdsec.conf` on the host (`/data/crowdsec/crowdsec.conf` in the container). Open it with an editor, for example `sudo nano /opt/npmpro/crowdsec/crowdsec.conf`.

Next to it, `crowdsec.conf.example` always holds the current default config of the image (it is replaced at every start, so do not edit it). Your `crowdsec.conf` is only created from the example when it is missing or empty; NPMpro does not change it otherwise. The same folder has `ban.html` and `captcha.html`, the pages shown to banned visitors, which you can edit; the `.example` copies are refreshed at every start.

### 8. Set the keys

Change these lines and leave the rest as it is:

```ini
ENABLED=true
API_URL=http://127.0.0.1:8080
API_KEY=<the key from step 6>
APPSEC_URL=http://127.0.0.1:7422
```

- `ENABLED=true` decides at the start of the container whether the bouncer is loaded (upper or lower case and spaces around `=` are fine). At every start NPMpro removes trailing spaces and Windows (CRLF) line endings from this file, so a file edited on Windows works too.
- `API_URL` is the address of the LAPI as NPMpro sees it. With the compose file above it stays `http://127.0.0.1:8080`.
- `APPSEC_URL` is the AppSec listener from step 4. **If you did not set up AppSec, clear it** (`APPSEC_URL=`). The default `APPSEC_FAILURE_ACTION=deny` blocks requests when AppSec cannot be reached, so an `APPSEC_URL` that points to nothing makes every host answer with 403. The admin UI and the container health check keep working when AppSec fails, so you can still log in (IP bans still apply there, and a working AppSec still checks them).

Save the file.

### 9. Restart NPMpro

```bash
docker restart npmpro
docker logs npmpro
```

The bouncer is loaded (or removed) at the start of the container, so a restart is needed after every change of `crowdsec.conf`; recreating the container is not needed. The docker logs show `[Crowdsec] Initialisation done` when the bouncer was loaded.

## The bouncer config file

All keys of `crowdsec.conf` with their defaults (from `crowdsec.conf.example`):

| Key | Default | Meaning |
|---|---|---|
| `ENABLED` | `false` | `true` loads the bouncer at the next start |
| `API_URL` | `http://127.0.0.1:8080` | the CrowdSec LAPI |
| `API_KEY` | empty | the bouncer key from `cscli bouncers add` |
| `USE_TLS_AUTH`, `TLS_CLIENT_CERT`, `TLS_CLIENT_KEY` | `false`, example paths | authenticate with a TLS client certificate instead of `API_KEY`; the files must be readable inside the container, for example under `/data/crowdsec/` |
| `SSL_VERIFY` | `true` | check the certificate of an `https://` LAPI or AppSec URL |
| `MODE` | `live` | `live` asks the LAPI per client IP and caches the answer for `CACHE_EXPIRATION` seconds (default 1). `stream` downloads all decisions every `UPDATE_FREQUENCY` seconds (default 10) and answers from memory |
| `REQUEST_TIMEOUT` | `3000` | timeout for LAPI requests in milliseconds |
| `BOUNCING_ON_TYPE` | `all` | which decision types are enforced |
| `FALLBACK_REMEDIATION` | `ban` | what to do with a decision type the bouncer does not know |
| `SCENARIOS_CONTAINING`, `SCENARIOS_NOT_CONTAINING` | empty | only enforce (or ignore) decisions whose scenario contains one of these comma-separated strings |
| `EXCLUDE_LOCATION` | empty | paths that are never checked |
| `ENABLE_INTERNAL` | `false` | also check internal requests (for example after a rewrite) |
| `BAN_TEMPLATE_PATH` | `/data/crowdsec/ban.html` | the ban page |
| `REDIRECT_LOCATION`, `RET_CODE` | empty | redirect banned visitors instead, or answer with another status code; they cannot be used together (`REDIRECT_LOCATION` wins) |
| `CAPTCHA_PROVIDER`, `SITE_KEY`, `SECRET_KEY` | empty | the captcha for decisions of type `captcha`: `recaptcha`, `hcaptcha` or `turnstile`, with the keys from that provider |
| `CAPTCHA_TEMPLATE_PATH`, `CAPTCHA_EXPIRATION` | `/data/crowdsec/captcha.html`, `3600` | the captcha page, and the seconds a solved captcha stays valid |
| `APPSEC_URL` | `http://127.0.0.1:7422` | the AppSec listener; empty turns AppSec off |
| `APPSEC_FAILURE_ACTION` | `deny` | what happens when AppSec cannot be reached: `deny` blocks the request, `passthrough` lets it through. The admin UI always lets it through |
| `APPSEC_CONNECT_TIMEOUT`, `APPSEC_SEND_TIMEOUT`, `APPSEC_PROCESS_TIMEOUT` | empty | AppSec timeouts (empty: the defaults of the bouncer) |
| `ALWAYS_SEND_TO_APPSEC` | `false` | also send requests of IPs that already have a decision to AppSec |
| `APPSEC_DROP_UNREADABLE_BODY` | `true` | drop requests whose body cannot be read (HTTP/2 or HTTP/3 requests without a content-length header, or gRPC requests) instead of sending them to AppSec without a body |

### Captcha instead of a ban

The bouncer supports the captcha remediation. Set `CAPTCHA_PROVIDER` and the `SITE_KEY` and `SECRET_KEY` from reCAPTCHA, hCaptcha or Cloudflare Turnstile, restart NPMpro, and decisions of type `captcha` show the captcha page instead of the ban page. Scenarios ban by default; a captcha decision comes from a CrowdSec profile that you change, or from `cscli decisions add --type captcha`. See the CrowdSec documentation on profiles.

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
6. **In the web UI:** the Monitoring page (administrators) has a **CrowdSec** tab whenever Monitoring is available, that is while traffic statistics are on or the bouncer is configured. Without a configured bouncer the tab says "CrowdSec is not configured". Once the bouncer is enabled with a key, Monitoring appears in the menu even with traffic statistics off, the tab shows the bans and the dashboard shows an **Active bans** card. The tab lists the active bans (total, added in the last 24 hours, by reason, origin and type, a map and the newest bans) and the connection state. NPMpro reads the bans with the key from `crowdsec.conf` and polls the LAPI every 60 seconds, so a new ban can take up to a minute to appear. It is read-only and shows no alerts. See [Monitoring](https://github.com/TheBlackBush/NPMpro#monitoring) in the README.
7. **AppSec:** request a path that a virtual patch blocks on one of your proxy hosts, for example `https://app.example.com/.env` (a 404 host does not block it). With AppSec working the answer is 403 from NPMpro, and `docker exec crowdsec cscli metrics` shows the request in the AppSec tables. Repeated hits like this can get your IP banned, so test from the second device or delete the decision afterwards.

## AppSec and your hosts

- **Request bodies are always buffered** on hosts and locations where AppSec is active, because AppSec needs the whole body. Turning on Disable Request Buffering therefore also turns on Disable Crowdsec Appsec for that host or location, and turning Disable Crowdsec Appsec off turns Disable Request Buffering off again. Response buffering is not affected.
- **AppSec blocks request bodies bigger than 10 MiB** by default. For hosts that receive bigger uploads (Nextcloud, photo libraries, backup targets) turn on **Disable Crowdsec Appsec**.
- **Where the option is:** in the proxy host dialog on the **Details** tab, under **Options**, the switch **Disable Crowdsec Appsec**. Each custom location has its own switch: open the location on the **Custom Locations** tab, its **Options** have the same switch. A custom location does not take over the switch of the host.
- The switch only turns off AppSec. Bans from the LAPI still apply to the host.
- Without `APPSEC_URL` the switch does nothing.

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

Then restart CrowdSec. nginx writes the client IP itself, so bans cannot be forged. The request line however is written as the client sent it: a crafted one can put any value into `target_fqdn`, so do not build whitelists on the domain of an error log alert.

## Firewall bouncer

The nginx bouncer blocks banned IPs at the HTTP level: nginx still accepts their connections and the TLS handshake. It is better to block as early as possible, so if you can, also install a firewall bouncer on the host: https://docs.crowdsec.net/u/bouncers/firewall. It drops the packets of banned IPs before they reach nginx, and it covers streams and other services too. Include the Docker iptables chains in its config (the `DOCKER-USER` chain), otherwise ports published by other containers are not covered. The nginx bouncer stays useful next to it for AppSec.

## Privacy

Unless you [turn off sharing](https://docs.crowdsec.net/docs/next/configuration/crowdsec_configuration/#sharing) in CrowdSec, the engine sends signals about detected attacks (including the attacking IPs and [this metadata](https://docs.crowdsec.net/docs/central_api/intro/#signal-meta-data)) to CrowdSec, and receives the community blocklist in return. Mention it in your privacy policy, see [Hints for Your Privacy Policy](https://github.com/TheBlackBush/NPMpro#hints-for-your-privacy-policy). With `crowdsecurity/http-extended-context` and an enrolled engine, the attacked domain is sent too.

## Troubleshooting

### Every host answers with 403

- **AppSec is configured but not reachable.** `APPSEC_URL` is set while the AppSec listener does not run (the acquisition file has no AppSec part, CrowdSec is stopped, or the port is not published), and `APPSEC_FAILURE_ACTION=deny` blocks everything. Check `docker logs crowdsec` for the AppSec listener, check that `127.0.0.1:7422` is published, or clear `APPSEC_URL` and restart NPMpro. `APPSEC_FAILURE_ACTION=passthrough` lets requests through while AppSec is down, at the cost of no protection in that time.
- **Your own IP is banned.** Run `docker exec crowdsec cscli decisions list` and delete the decision with `cscli decisions delete --ip <ip>`. If CrowdSec bans the IP of a proxy in front of NPMpro, set Trusted proxy IPs (see [Requirements](#requirements)).
- **Uploads fail with 403** on a host that receives big files: turn on Disable Crowdsec Appsec for it (see [AppSec and your hosts](#appsec-and-your-hosts)).

### The bouncer does not connect

- Look into `docker logs npmpro` for lines starting with `[Crowdsec]`. No `[Crowdsec] Initialisation done` after a restart means the bouncer was not loaded: check that `ENABLED=true` is written exactly like that. Also check for a typo in the key name (`ENABLED`) and that the container was restarted after the change.
- `API_URL` must be reachable from NPMpro. With `network_mode: host` and the compose file above that is `http://127.0.0.1:8080`. Test it from the host with `curl http://127.0.0.1:8080/v1/decisions -H "X-Api-Key: <key>"`: a working key returns `null` or a list, a wrong key returns 403.
- A wrong or deleted key: create a new one (step 6), put it into `crowdsec.conf` and restart NPMpro.
- Changes of `crowdsec.conf` only apply after `docker restart npmpro`.

### The CrowdSec tab says "CrowdSec is not configured"

The tab needs `ENABLED=true`, an `API_URL` and an `API_KEY` (or `USE_TLS_AUTH=true` with a certificate and key) in `crowdsec.conf`. "CrowdSec could not be reached" means the config is fine but the LAPI did not answer; NPMpro tries again every minute and shows the reason.

### No alerts and no bans

- Check that Write log files is on and `/opt/npmpro/nginx/logs/access.log` grows.
- Check that the CrowdSec container mounts the log folder (step 1) and that `cscli metrics` shows the file with parsed lines.
- "Lines unparsed" grows while "Lines parsed" stays at 0 or low: the parser is outdated. Run `docker exec crowdsec cscli hub update`, `docker exec crowdsec cscli hub upgrade` and `docker restart crowdsec` (step 2).
- Normal traffic does not create bans. Use the test ban above to check the bouncer.

### Logs

- NPMpro and the bouncer: `docker logs npmpro` (the nginx error log is always written there, and to `/opt/npmpro/nginx/logs/error.log` with Write log files on).
- CrowdSec: `docker logs crowdsec`, `docker exec crowdsec cscli metrics`, `docker exec crowdsec cscli alerts list`.

For the full picture of alerts, decisions and metrics, the companion project [CrowdSec Web UI](https://github.com/TheDuffman85/crowdsec-web-ui) is recommended.
