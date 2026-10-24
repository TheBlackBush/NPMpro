# NPMpro

NPMpro is a hardened nginx-proxy-manager fork: a custom-compiled nginx (HTTP/3, brotli/zstd, lua, njs, ECH), a Node.js backend that generates the nginx configs and a React web UI, shipped as one Alpine Docker image. See [Credits](#credits) for its origins.

Images: `ghcr.io/theblackbush/npmpro` and `blackbush/npmpro` (tags: `latest`, `develop` and version tags like `1.0.0`). Use the [compose.yaml](compose.yaml) of this repository. Source and issues: https://github.com/TheBlackBush/NPMpro

If you don't need the web GUI of NPMpro, you may also have a look at caddy: https://caddyserver.com

- [Compatibility (to Upstream)](#compatibility-to-upstream)
- [Quick Setup](#quick-setup)
- [Upgrading from NPMplus](#upgrading-from-npmplus)
- [Migration from upstream/vanilla nginx-proxy-manager](#migration-from-upstreamvanilla-nginx-proxy-manager)

**Note: this fork is distributed under the GNU Affero General Public License version 3 or any later version. It is based on the MIT licensed [nginx-proxy-manager](https://github.com/NginxProxyManager/nginx-proxy-manager).** <br>
**Note: by running NPMpro you agree to the ToS of Let's Encrypt/your custom CA.** <br>
**Note: remember to expose udp/quic for the https port (443/udp).** <br>
**Note: remember to add your domain to the [hsts preload list](https://hstspreload.org) if you enabled hsts for your domain.** <br>
**Note: please report issues at https://github.com/TheBlackBush/NPMpro/issues.** <br>

## List of some changes

- HTTP/3 (QUIC), needs https exposed over udp
- crowdsec (and appsec) support
- hardened TLS by default:
  - patched nginx build with aws-lc compiled form source
  - enforced cipher/curve order, certificate compression (zlib-ng+brotli)
  - optional encrypted client hello (ech)
- shortlived letsencrypt certificates by default, plus proper support for other acme servers
- mTLS with client certificates per host
- more ways to serve a host: grpc, proxy protocol, loadbalancing over multiple upstreams, and serving files or php directly with fancyindex support
- built-in auth_request support for the common auth providers, no advanced config needed
- OIDC login for the web UI
- multiple access lists per host and per location
- security headers always sent, fingerprinting headers stripped, based on the OWASP secure headers project
- hardened web UI itself: https, strict CSP, httpOnly cookie instead of local storage, rate limits and more
- opt-in logging
- zstd and brotli compression in addition to gzip
- Goaccess log analytics (/goaccess) and a Swagger UI (/api/docs) for the api, both in the web UI
- password/mfa reset (only sqlite): `docker exec -it npmpro password-reset.js USER_EMAIL [--disable-mfa]`, the new password is read from stdin
- database backup before upgrades (only sqlite): before running database migrations, the database is copied to `/data/npmpro/backups` (the newest 5 are kept). To go back to the previous image, stop the container, replace `/data/npmpro/database.sqlite` with the backup (remove `database.sqlite-wal` and `database.sqlite-shm` next to it) and start the previous image
- host configs that are missing on startup are regenerated, even when no env or template changed
- alpine based, much smaller image
- punycode domain support
- option to replace custom certs
- saved DNS credentials: enter DNS provider credentials once (Certificates, DNS credentials tab) and reuse them; they are stored encrypted with the key /data/npmpro/dns-credentials.key, keep it with your backups, without it saved credentials must be entered again
- many other things, see this README.md and the compose.yaml

## Compatibility (to Upstream)
- Supported architectures: x86_64-v2/amd64v2 (check with `/lib/ld-linux-x86-64.so.2 --help`, plain x86-64 is not supported only v2 and up) and aarch64/arm64 (other archs (including 64-bit ones) and any 32-bit arch (like armhf/armv7 (dropped), armel/armv6) are not supported, because of the duration to compile).
- NPMpro is built for docker (CI builds the image and checks that it starts healthy), but podman should also work (running the NPMpro container inside an LXC container is discouraged, it will work, but it works better without, install docker/podman on the host or in a KVM and run NPMpro with this)
- MariaDB(/MySQL)/PostgreSQL may work as Databases for NPMpro (configuration like in upstream), but are unsupported, have no advantage over SQLite (at least with NPMpro) and are not recommended. Please note that you can't migrate from any of these to SQLite without making a fresh install and/or copying everything yourself.
- NPMpro uses https instead of http for the admin interface
- NPMpro won't trust cloudflare until you set the env TRUST_CLOUDFLARE to true, but please read [this](#notes-on-cloudflare) first before setting the env to true.
- route53 is not supported as dns-challenge provider and Amazon CloudFront IPs can't be automatically trusted in NPMpro, even if you set TRUST_CLOUDFLARE env to true.
- The following certbot dns plugins have been replaced, which means that certs using one of these proivder will not renew and need to be recreated (not renewed): `certbot-dns-he`, `certbot-dns-dnspod`, `certbot-dns-online`, `certbot-dns-powerdns` and `certbot-dns-do` (`certbot-dns-do` was replaced in upstream with v2.12.4, this change is included in NPMpro)
- There are many changed and improvements to the nginx config, so please don't follow guides in the internet about custom/advanced config, they are either redundant or should not be used at all with NPMpro
- Many forms have changed behavior, see [Comments on some buttons](#comments-on-some-buttons)

## Quick Setup
1. Install Docker and Docker Compose (podman or docker rootless may also work)
- [Docker Install documentation](https://docs.docker.com/engine/install)
- [Docker Compose Install documentation](https://docs.docker.com/compose/install/linux)
2. Download this [compose.yaml](https://raw.githubusercontent.com/TheBlackBush/NPMpro/refs/heads/develop/compose.yaml) (or use its content as a portainer stack)
3. Adjust TZ to match your Timezone and maybe adjust other env options to your needs
4. Start NPMpro by running (or deploy your portainer stack)
```bash
docker compose up -d
```
5. Log in to the Admin UI: When your docker container is running, connect to the admin interface using `https://` on port `81`.

## Upgrading from NPMplus

NPMpro can take over an existing NPMplus data volume. Paths like `/data/...` are paths inside the container; on the host, `/data` is the folder you mounted to it (for example `/opt/npmplus`).

- On the first start, NPMpro copies `/data/npmplus` to `/data/npmpro`, checks the copy (content comparison and, for SQLite, a database integrity check) and renames the old folder to `/data/npmplus.backup-<date>`, with a `MOVED-TO-NPMPRO.txt` note inside. If a check fails, the container stops starting and waits, showing the reason in the logs, and `/data/npmplus` stays unchanged. If both `/data/npmplus` and `/data/npmpro` exist, NPMpro keeps `/data/npmpro`, unless `/data/npmplus/database.sqlite` is newer: then it changes nothing, waits, and asks you to move the folder you do not want out of `/data`.
- The database is then migrated: tables and columns named `npmplus_*` become `npmpro_*`. NPMplus images cannot use the migrated database.
- The host path of the volume does not matter to NPMpro. You can keep `/opt/npmplus` or rename it to `/opt/npmpro` while the container is stopped.
- Users stay logged in. An OIDC login that is in progress during the upgrade has to be started again.
- External databases (MySQL/MariaDB via `DB_MYSQL_*`, Postgres via `DB_POSTGRES_*`) are renamed in place and are not part of the data folder backup. Dump the database before upgrading. External databases need MySQL 8.0 or later or MariaDB 10.5.2 or later (any supported Postgres version works).
- Once everything works, you can delete `/data/npmplus.backup-<date>`.

To go back to NPMplus: stop the container, move `/data/npmpro` away, rename `/data/npmplus.backup-<date>` back to `/data/npmplus` and start the NPMplus image. This only restores SQLite installs, because their database lives in that folder. With an external database, also restore the dump you made before upgrading.

## Migration from upstream/vanilla nginx-proxy-manager
- **NOTE: Migrating back to the original version is not possible.** Please make a **backup** before migrating, so you have the option to revert if needed
1. Please read [this](#compatibility-to-upstream) first
2. make a backup of your data and letsencrypt folders (creating a copy using `cp -a` should be enough)
3. download the latest compose.yaml of NPMpro
4. adjust your paths (of /etc/letsencrypt and /data) to the ones you used with nginx-proxy-manager
5. adjust TZ to match your Timezone and maybe adjust other env options to your needs
6. stop nginx-proxy-manager
7. deploy the NPMpro compose.yaml
8. You should now remove the `/etc/letsencrypt` mount, since it was moved to `/data` while migration, then redeploy the compose file
9. Since many forms have changed, please check if they are still correct for every host you have.
10. If you proxy NPMpro (or NPM) through another NPMpro (or NPM) instance make sure to change the scheme from http to https
11. Maybe setup crowdsec (see below)
12. Please report all (migration) issues you may have

# Crowdsec
Note: If you don't [disable sharing in crowdsec](https://docs.crowdsec.net/docs/next/configuration/crowdsec_configuration/#sharing), you may need to mention that [this](https://docs.crowdsec.net/docs/central_api/intro/#signal-meta-data) is sent to crowdsec in your privacy policy.
1. Install crowdsec and the ZoeyVid/npmplus collection for example by using crowdsec container in the compose.yaml. These are the names of the CrowdSec hub collection and bouncer that NPMpro uses, so they keep their original spelling. You may also want to install some of these optional collections by editing the `COLLECTIONS` env:
    - [crowdsecurity/http-dos](https://app.crowdsec.net/hub/author/crowdsecurity/collections/http-dos): detects http dos tools which the default http scenarios miss, but be warned of false positives
    - [crowdsecurity/appsec-crs](https://app.crowdsec.net/hub/author/crowdsecurity/collections/appsec-crs): the OWASP Core Rule Set, it is loaded out-of-band, so matching requests are not blocked, but an IP triggering more than 5 rules gets banned, you also need to uncomment `crowdsecurity/crs` in step 3
    - [crowdsecurity/http-extended-context](https://app.crowdsec.net/hub/author/crowdsecurity/collections/http-extended-context): adds the attacked domain to the alert context, which is sent to crowdsec if your instance is enrolled in the console
2. Set LOGROTATE to `true` in your `compose.yaml` and redeploy
3. Open `/opt/crowdsec/conf/acquis.d/npmpro.yaml` (path may be different depending how you installed crowdsec) and fill it with:
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
4. Restart the crowdsec container
5. Make sure to use `network_mode: host` in your compose file for the NPMpro container
6. Run `docker exec crowdsec cscli bouncers add npmpro` and save the api key of the output
7. Open `/opt/npmpro/crowdsec/crowdsec.conf`
8. Set `ENABLED` to `true`
9. Use the output of step 6 as `API_KEY`
10. Save the file
11. Redeploy the `compose.yaml`
12. It is recommended to block at the earliest possible point, so if possible set up a firewall bouncer: https://docs.crowdsec.net/u/bouncers/firewall, make sure to also include the docker iptables in the firewall bouncer config
13. Note that when crowdsec appsec is enabled for a host/location, request bodies will always be buffered, so setting `proxy_request_buffering` to off will not work there, response buffering is not affected
14. Note that appsec blocks requests with a body bigger than 10 MiB by default, so you may want to enable "Disable Crowdsec Appsec" for hosts/locations which receive bigger uploads (like Nextcloud)

## Bot detection (optional)
Bot detection challenges every request without a valid cookie, so clients which can not solve it, like apps, get blocked. Full documentation: https://doc.crowdsec.net/docs/next/appsec/bot_detection/enable, the short version:
1. Add `crowdsecurity/appsec-bot-challenge`, `crowdsecurity/appsec-bot-challenge-strict` or `crowdsecurity/appsec-bot-challenge-permissive` to the `COLLECTIONS` env, depending on your wanted threshold
2. Uncomment `crowdsecurity/appsec-bot-*` in the acquisition file from step 3, the wildcard only matches appsec-configs you actually installed
3. Restart crowdsec

## Rate limiting (optional)
If you added rate limiting (`limit_req_zone`/`limit_req`) through the advanced config or `/data/custom_nginx`, `crowdsecurity/nginx-req-limit-exceeded` from the ZoeyVid/npmplus collection needs the error log, since nginx only writes the `limiting requests, excess` lines there. Add it to the acquisition file from step 3:
```yaml
filenames:
  - /opt/npmpro/nginx/logs/access.log
  - /opt/npmpro/nginx/logs/error.log
labels:
  type: npmplus
```
nginx writes the client IP itself, so bans can not be forged. The request line however is written out as the client sent it, a crafted one can put any value into `target_fqdn`, so do not build whitelists on the domain of an error log alert.

## Use of external php-fpm (recommended)
To set it per location: press the gear button, set the scheme to `path`, put in the path and paste the following in the new text field at the bottom, you need to adjust the last line:
```
location ~* [^/]\.php(?:$|/) {
  fastcgi_split_path_info ^(.*\.php)(/.*)$;
  try_files $fastcgi_script_name =404;
  fastcgi_pass ...; # set this to the address of your php-fpm (socket/tcp): https://nginx.org/en/docs/http/ngx_http_fastcgi_module.html#fastcgi_pass
}
```

## Use of inbuilt php-fpm (not recommended)
1. First enable php inside your compose file (you can add more php extension using envs in the compose file)
2. Set the forwarding port to the php version you want to use and is supported by NPMpro (like 83/84/85)

## OIDC login
OIDC is set up under Settings, Authentication in the web UI (administrators only). Enter the issuer URL, client ID, client secret and redirect domain, register the shown callback URL at your provider, then enable it. The sign-in page then shows a button with the name, colour and icon you choose.
- Environment variables win: `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_DOMAIN`, `OIDC_REQUIRE_VERIFIED_EMAIL`, `OIDC_SKIP_MFA` and `OIDC_DISABLE_PASSWORD` override the saved value of their field. The field is shown as "Set by environment" and cannot be changed in the UI. If the four connection variables are all set, OIDC is active without enabling it in the UI.
- Scopes default to `openid email profile`. A provider that only allows some scopes may need this changed (for example to `openid email`).
- Disable password login: only OIDC can then be used to sign in. This can only be turned on from a session that signed in with OIDC, and a session that signed in with a password also cannot save a change that would switch it on in effect (for example enabling OIDC while it is still set). A value set by `OIDC_DISABLE_PASSWORD` is not affected. To restore password login set `OIDC_DISABLE_PASSWORD=false` and restart the container.
- Require a verified email (default on) refuses users whose provider has not verified their email address. Skip two-factor after OIDC (default off) trusts the multi-factor check of the provider.
- Create users on their first sign-in (default off): a person without an account gets one with the default permissions set on the page. Allowed email domains limit this (comma separated, empty allows any domain; they are dotted host names such as `example.com`, single-label and non-ASCII names are not accepted). Enabled users can always sign in. Warning: with an empty domain list and Require a verified email off, anyone your provider will authenticate gets an account, under any email address they can set at the provider. New users are never administrators, an access list cannot be hidden while proxy hosts are visible, and certificates cannot be hidden while any host type is visible.
- Button icon: choose a built-in icon, upload a file or download one from a URL. PNG, JPEG, WebP and SVG are accepted, up to 256 KB. SVG files that contain scripts, event handlers, embedded documents or references to other files (anything but `#` fragments and inline PNG, JPEG or WebP images) are refused.
- Sign-in errors are shown on the sign-in page by code: `not_configured`, `provider_error`, `no_email`, `email_not_verified`, `no_user` (no account and auto-create is off), `domain_not_allowed` (email domain not in the allowed list) and `user_disabled`.

## Monitoring
Administrators get a Monitoring page in the web UI with a Traffic tab (`/monitoring/traffic`) and a CrowdSec tab (`/monitoring/crowdsec`), plus a short monitoring row on the dashboard. It is read-only.
- Traffic statistics are off by default. Turn them on under Settings, Monitoring (`/settings/monitoring`). NPMpro then reads the nginx access log itself and counts requests, bytes sent and status classes per host. Switching the setting in the UI turns the access log on or off without a restart. With `LOGROTATE=true` or `TRAFFIC_STATS=true` the access log is already on when the container starts.
- Counts are stored per minute for the last 24 hours and per hour for the whole retention period (30 days by default, adjustable from 7 to 365 days).
- Requests for names that are not one of your hosts (the default site, requests by IP, random names) are grouped as "Other hosts". Requests for hosts with a trailing wildcard (`www.example.*`) or a regex name also land there.
- NPMpro's own requests are not counted: everything nginx receives on the admin UI port (`NPM_PORT`, also behind a remapped Docker port), which includes the container health check. If `NPM_PORT` is 80 or 443, only the health check itself (from the container or `NPM_IPV4_BINDING`) is left out. The access log records the receiving port as its last field (`$server_port`).
- Countries and networks (ASN) are always counted when GeoIP databases exist. Show visitor IPs (off by default) additionally stores the top visitor IPs. Turning it off deletes all stored IPs.
- Count unique visitors (Settings, Monitoring, off by default) shows how many different visitors each host has per day and for the selected range, without storing any IP. Visitors are counted per UTC day, so the range count starts at the beginning of the UTC day the range starts on (24 hours can cover two calendar days, 7 days eight). For every visitor, host and UTC day NPMpro stores only a keyed hash: HMAC-SHA256 of the visitor IP with a random key that is created once and stored encrypted in the database (it never leaves the server), cut to the first 16 bytes. An IPv4-mapped IPv6 address counts as IPv4; other IPv6 addresses count per /64 network, so one device that changes its address counts once (several users on the same /64 count as one). The hashes are kept for the traffic retention days. Turning the setting off deletes all stored hashes before the change is saved. Each visitor is counted once per host and day (IPv6 addresses per /64 network), up to the visitor limit (Settings, Monitoring, 100000 by default, 1000 to 1000000); when a host reaches it on a day the count is shown with a plus sign ("100000+"). The 1 hour range shows the visitors of the current UTC day.
- Top hosts are grouped per NPMpro host (proxy, redirection or 404 host) with all its domain names. A host row links to the page filtered to that host (the URL keeps `host_type` and `host_id`). Every top list shows at most 10 rows.
- GeoIP is set up under Settings, GeoIP (`/settings/geoip`): enter your MaxMind account ID and license key ([create them here](https://www.maxmind.com/en/geolite2/signup)) and choose the editions (`GeoLite2-Country` and `GeoLite2-ASN` by default, `GeoLite2-City` is optional). NPMpro downloads the databases itself: when the credentials or editions are changed, when "Update now" is used, and automatically every 3 days (a failed automatic update is retried after 24 hours). A separate geoipupdate container is not needed anymore, but the old container still works. The files are stored in `/data/goaccess/geoip`, the same place GoAccess and the [geoblocking example](#geoblocking-example-mainly-community-support) read them from. Without databases the map and the country and network lists are hidden, the rest works.
- CrowdSec bans: the CrowdSec tab shows the currently active bans (total, added in the last 24 hours, by reason (the CrowdSec scenario), origin and type, a map and the newest bans). It needs the bouncer of the [Crowdsec](#crowdsec) section enabled (`ENABLED=true` in `/data/crowdsec/crowdsec.conf`) with an API key or a TLS client certificate. NPMpro reads the bans with those bouncer settings (including `SSL_VERIFY`), read-only, and polls the LAPI every 60 seconds. It needs no additional key. Only active bans are shown, no alerts.
- For alerts, decision management and CrowdSec metrics I recommend the companion project [CrowdSec Web UI](https://github.com/TheDuffman85/crowdsec-web-ui).
- Environment variables win over the saved value and lock their field in the UI ("Set by environment"):
  - `TRAFFIC_STATS` (`true` or `false`), `LOGROTATE=true` also turns traffic statistics on and locks the setting
  - `TRAFFIC_RETENTION_DAYS` (7 to 365, default 30; any other value stops the container from starting)
  - `TRAFFIC_SHOW_IPS` (`true` or `false`, default false)
  - `TRAFFIC_UNIQUE_VISITORS` (`true` or `false`, default false)
  - `TRAFFIC_VISITORS_CAP` (visitor limit per host and day, 1000 to 1000000, default 100000; any other value stops the container from starting)
  - `GEOIP_ACCOUNT_ID`, `GEOIP_LICENSE_KEY` and `GEOIP_EDITIONS` (space separated, for example `GeoLite2-Country GeoLite2-ASN`; unknown edition names are ignored, and if none is valid the variable is ignored and the field stays editable)

## Comments on some buttons
- Forward Hostname / IP / Path: if the scheme is set to path you can just put here a path in and nginx works as a file server, otherwise you need to input ip/domain, you can also append a path to the ip/domain like `127.0.0.1/path` to proxy to a subpath.
  - For custom locations with a set path, the path of the location will be stripped. So a request `GET /cdf/abc` to a custom location `/cdf` which proxies to `127.0.0.1/abc` will proxy to `127.0.0.1/abc/abc`, a custom location `/cdf/` which proxies to `127.0.0.1/` will proxy to `127.0.0.1/abc`  and a custom location `/cdf` which proxies to `127.0.0.1` will proxy to `127.0.0.1/cdf/abc`
  - If the scheme is set to `path`, a path ending with a `/` will be searched relative to the custom location (is uses nginx alias) and a path ending without a `/` will be searched relative to the main `/` location (it uses nginx root)
- Forward Port (optional): port of upstream or php version if scheme is `path`
- Send noindex header and block some user agents: This does what is says, it appends a header to all responses which says that the site should not be indexed while blocking requests of crawlers based on the user agent sent with the request
- Disable Crowdsec Appsec: this will disable crowdsec appsec only for one host/one location, this will only do something if appsec is configured
- Disable Response Buffering: Most time you want keep buffering enabled, you may want to disable this if you for example want to stream videos and you have a fast and stable connection to the upstream server, this effects the connection from the upstream server to NPMpro
- Disable Request Buffering: Most time you want keep buffering enabled, request buffering will always be enabled if crowdsec appsec is enabled, you may want to disable this if you for example want to upload huge files and have a fast and stable connection to the upstream server, this effects the connection from the NPMpro to the upstream server
- Enable compression by upstream: this will allow the backend to compress files, it is recommended to keep this disabled unless your backend provides precompressed assets, there may be cases where this is needed since otherwise the upstream missbehaves for some reason (like collabora in nextcloud all-in-one)
- Enable fancyindex: this will enabled fancyindex, which shows a index of all files in the folder if there is no index file, only enable this if you know what you are doing and you need the index
- Websockets: this button was removed, websockets are now always enabled
- Reuse Key: this will make the new cert always keep its key unless you force renew it, it is recommended to keep this disabled (not to keep the key), a reason to keep the key would be TLSA/pubkey pinning
- TLS to upstream (for Streams): This can be used if your stream target already uses tls but you want to override it with a NPMpro cert, do not enable if you don't set a new cert, since this will downgrade the connecting to be unencrypted
- X-Frame-Options: will control the X-Frame-Options header, none will remove the header, SAMEORIGIN/DENY will set it to these values and upstream will keep what upstream sends

## Examples of implementing some services using auth_request

Note: The upstream URL for an auth request provider can be overridden in the UI; a main location's override takes precedence over any custom location's override.

### Anubis
1. Deploy an anubis container (see the compose.yaml for an example and information)
2. In the mounted anubis bot policy file the "status_codes" should be set to 401 and 403, like this:
```yaml
status_codes:
  CHALLENGE: 401
  DENY: 403
```
3. Set the AUTH_REQUEST_ANUBIS_UPSTREAM env in the NPMpro compose.yaml and select anubis in the Auth Request selection, no custom/advanced config/locations needed
4. You can override the "allow", "checking" and "blocked" images used by default by putting put your custom images as happy.webp, pensive.webp and reject.webp to /opt/npmpro/anubis and restarting NPMpro

### Tinyauth
1. Set the AUTH_REQUEST_TINYAUTH_UPSTREAM env in the NPMpro compose.yaml and select tinyauth in the Auth Request selection, no custom/advanced config/locations needed

### OAuth2Proxy
1. Set the AUTH_REQUEST_OAUTH2PROXY_UPSTREAM env in the NPMpro compose.yaml and select oauth2proxy in the Auth Request selection, no custom/advanced config/locations needed

### VoidAuth
1. Set the AUTH_REQUEST_VOIDAUTH_UPSTREAM env in the NPMpro compose.yaml and select voidauth in the Auth Request selection, no custom/advanced config/locations needed

### Authelia (modern)
1. Set the AUTH_REQUEST_AUTHELIA_UPSTREAM env in the NPMpro compose.yaml and select authelia (modern) in the Auth Request selection, no custom/advanced config/locations needed

### Authentik (single application)
1. Set the AUTH_REQUEST_AUTHENTIK_UPSTREAM env in the NPMpro compose.yaml and select authentik/authentik-send-basic-auth in the Auth Request selection, no custom/advanced config/locations needed

## Load Balancing
1. Open and edit this file: `/opt/npmpro/custom_nginx/http_top.conf` (or `/opt/npmpro/custom_nginx/stream_top.conf` for streams), if you changed /opt/npmpro to a different path make sure to change the path to fit
2. Set the upstream directive(s) with your servers which should be load balanced (https://nginx.org/en/docs/http/ngx_http_upstream_module.html / https://nginx.org/en/docs/stream/ngx_stream_upstream_module.html), they need to run the same protocol (either http(s) or grpc(s) for proxy hosts or tcp/udp/proxy protocol for streams), like this for example:
```
upstream cu_mybackend {
  zone cu_mybackend 128k;
  server 127.0.0.1:44 resolve;
  server 127.0.0.1:33 resolve;
  server 127.0.0.1:22 resolve;
  server 192.168.1.11:44 backup resolve;
}
```
3. Configure your proxy host/stream like always in the UI, but set the hostname to the exact name of your upstream block (e.g. `cu_mybackend`) and leave the forward port field empty (ports are defined inside the upstream block)
   - The `cu_` prefix (short for **c**ustom **u**pstream) is required: NPMpro uses it to detect that the hostname refers to a custom upstream block and skips generating its own upstream block for it
   - This also works for auth request upstreams (env or UI field), use the scheme and the name of your upstream block without port (e.g. `http://cu_myauth`), SNI and Host header are then set to the requested host like for proxy hosts, so the servers inside the upstream block need to point directly to the auth service and not to NPMpro itself

## Encrypted Client Hello (ECH)

- NPMpro supports generating and automatically rotating Encrypted Client Hello (ECH) keys. To enable and configure ECH, you need to set up a cron script that triggers the key generation and updates your DNS records.
- When the container starts, it automatically creates an empty file at `/opt/npmpro/tls/ech/cron.sh`. You need to fill this file with a script to handle your ECH keys. 
- If this file is not empty, NPMpro will automatically execute it regularly, enable ECH in the nginx configuration, and reload nginx after execution.
- Inside your `cron.sh`, use the built-in `ech.sh` command to generate your keys. The syntax is: `ech.sh <public-name> <identifier> [max-name-length (default 64)]`.
- This command generates the keys in `/opt/npmpro/tls/ech/` (saving the current and previous keys) and outputs the Base64-encoded ECH config list to standard output, which you can capture to update your DNS records.
- Because ECH requires advertising your public key via an HTTPS DNS record, your `cron.sh` must push the newly generated config to your DNS provider. 
- There is an example cron.sh script for Cloudflare in the repository: [`ech-cron-cloudflare-example.sh`](ech-cron-cloudflare-example.sh). You can adapt this script, add your API tokens, define your zones/records, and place its contents into `/opt/npmpro/tls/ech/cron.sh`.
- By default, the container will run your `cron.sh` script and reload nginx on container start and then every hour after container start. You can change this interval by setting the `ECH_ROTATION_INTERVAL` environment variable in your `compose.yaml`.
- It is recommended to use your servers hostname/PTR record as public name, make sure a (dead) host with a valid cert for your public name exists. The "identifier" is only used as part of the filename.
- It is recommended to only use one ECH key shared for all your hosts. If you configure multiple ECH keys then only the one with the alphabetically first "identifier" will be used in the retry_configs response.
- Do not set HTTPS records for FQDNs which use a CNAME record, but set them for the CNAME target, as only the HTTPS record of the CNAME target will be used by chromium.
- Deleting/clearing the cron.sh will disable ECH, but you still need to remove ECH from the HTTPS records yourself

## Geoblocking example (mainly community support) 

1. get the GeoLite2 databases: either enter your MaxMind credentials under Settings, GeoIP (see [Monitoring](#monitoring)), or deploy an optional geoipupdate container (see the compose.yaml for an example, create credentials [here](https://www.maxmind.com/en/geolite2/signup))
2. open and edit this file: `/opt/npmpro/custom_nginx/http_top.conf`, if you changed /opt/npmpro to a different path make sure to change the path to fit, the database is only reread when nginx reloads
```yaml
geoip_country /data/goaccess/geoip/GeoLite2-Country.mmdb;

# whitelist example, you can add as many country codes as you want, country code list: https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2#XY
#map $geoip_country_code $geoip2_country_rule {
#  default no;
#  AA yes;
#  XY yes;
#  '' yes; # if you want to allow IPs with unknown country codes, if you don't do this make sure to allow private IPs
#}

# blacklist example, you can add as many country codes as you want, country code list: https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2#XY
#map $geoip_country_code $geoip2_country_rule {
#  default yes;
#  AA no;
#  XY no;
#  '' no; # if you want to block IPs with unknown country codes, if you do this make sure to allow private IPs
#}

# uncomment if you block/don't allow IPs with unknown country codes
#geo $is_private_ip {
#  default no;
#  127.0.0.0/8 yes;
#  10.0.0.0/8 yes;
#  172.16.0.0/12 yes;
#  192.168.0.0/16 yes;
#  169.254.0.0/16 yes;
#  ::1/128 yes;
#  fc00::/7 yes;
#  fec0::/10 yes;
#}
```  
3a. to set it per location: press the gear button (on the tab itself, not the tab selection) on the details tab (or on the custom location you want to use), set your proxy settings and paste the following in the new text field at the bottom, you may want to adjust the last lines (do not use the advanced tab with this example as it may break cert renewals):
```yaml
# uncomment if you block/don't allow IPs with unknown country codes
#if ($is_private_ip = yes) { 
#  set $geoip2_country_rule yes; 
#} 
if ($geoip2_country_rule = no) { 
  return 444; # this rejects the connection, but you can also return 403 to tell the client that it was denied
} 
```
3b. to set it for an entire host: put this in the advanced tab:
```yaml
# uncomment if you block/don't allow IPs with unknown country codes
#if ($is_private_ip = yes) { 
#  set $geoip2_country_rule yes; 
#}
if ($request_uri ~* "^/\.well-known/acme-challenge/") {
    set $geoip2_country_rule yes;
}
if ($geoip2_country_rule = no) { 
  return 444; # this rejects the connection, but you can also return 403 to tell the client that it was denied
} 
```
3c. to set it for all http hosts of them same type: put this in the `custom_nginx/server_proxy.conf` / `custom_nginx/server_redirect.conf` / `custom_nginx/server_dead.conf` file(s):
```yaml
# uncomment if you block/don't allow IPs with unknown country codes
#if ($is_private_ip = yes) { 
#  set $geoip2_country_rule yes; 
#}
if ($request_uri ~* "^/\.well-known/acme-challenge/") {
    set $geoip2_country_rule yes;
}
if ($geoip2_country_rule = no) { 
  return 444; # this rejects the connection, but you can also return 403 to tell the client that it was denied
} 
```
3d. to set it for all http hosts: put this in the `custom_nginx/server_http.conf` file:
```yaml
# uncomment if you block/don't allow IPs with unknown country codes
#if ($is_private_ip = yes) { 
#  set $geoip2_country_rule yes; 
#}
if ($request_uri ~* "^/\.well-known/acme-challenge/") {
    set $geoip2_country_rule yes;
}
if ($geoip2_country_rule = no) { 
  return 444; # this rejects the connection, but you can also return 403 to tell the client that it was denied
} 
```
4. you can create multiple rule lists by adding multiple map directive, but you need to use a unique name instead of `$geoip2_country_rule` for each rule list (you need the unique name also in the custom locations)

## Prerun scripts (EXPERT option) - if you don't know what this is, ignore it
If you need to run scripts before NPMpro launches put them under: `/opt/npmpro/prerun/*.sh` (please add `#!/usr/bin/env sh` / `#!/usr/bin/env bash` to the top of the script) you need to create this folder yourself, also set the `ENABLE_PRERUN` env to `true`

## Notes on Cloudflare
- Using cloudflare proxy/tunnel before NPMpro (so between the users and NPMpro `users <=> cloudflare <=> NPMpro`) is strongly discouraged
- Why?
  - cloudflare acts like a "man in the middle" (if you want you can also call it a "wanted man-in-the-middle attack"), this means all traffic going from your users to you/from you to your users will be decrypted by cloudflare before being encrypted again and being forwarded to you/your users, if you want this is your decision (security, privacy, etc.)
  - many optimizations done by NPMpro will because of this only be used between cloudflare and NPMpro, so your users won't notice them
  - cloudflare overrides many things done/configured by NPMpro (like headers (including HSTS), HTTP/3 (QUIC), TLS settings and more), so you might need to configure them again in Cloudflare, but this is not always possible
  - cloudflare has a limit of 100MB per connection, so uploading/downloading big files may cause problems, if no chunking is used
  - because all data does not take direct way between your users and you, the connection time will increase
  - cloudflare only forwards/protects http(s) traffic on port 80/443 to you, services running on other ports/different protocols are not forwarded/protected (STUN/TURN/SSH)
  - cloudflare can't protect you if the attacker knows your real ip, as cloudflare only rewrites your dns entries to itself and then acts as a reverse proxy, direct ip connectings to you are not protected (use a firewall like ufw, make sure to allow 80/tcp and 443/tcp+udp for NPMpro, if possible don't open SSH and NPMpro GUI to the internet, but secure them behind a VPN like Wireguard)
  - if you need a WAF => use [crowdsec](#crowdsec)
  - if you want to use the "I'm under attack mode" to protect you from (ai) web scrapes => use [anubis](#anubis-config-supported)
- What are reason for cloudflare?
  - The points above don't matter you (enough) and:
    - you depend on a not mentioned and unreplaceable feature of cloudflare
    - or you are under (a) DDoS-attack(s), which you can't handle yourself and the attacker does not know your real ip/does not use it to attack you, but instead your domain: you could use cloudflare as dns nameserver for your domain with the proxy disabled and only enable it if you are under an attack (only work if the attacker did not cache your real ip)
    - or you want to hide your IP and only expose http(s) services, but then: don't use NPMpro at all, install cloudflared and use cloudflare tunnels and point it directly to your upstreams, this way you can still manage everything in a GUI and you don't even need to expose any ports
- If you still want to use cloudflare proxy make sure to set `your domain => SSL/TLS => SSL/TLS encryption => Current encryption mode => Configure` to "Full (strict)"
- If you use cloudflare proxy and your local dns server resolves your domains directly to NPMpro (split dns/dns rewrites), make sure it also overrides or blocks (empty answer) their HTTPS (type 65) records, otherwise browsers may use the ECH config of cloudflare (public name `cloudflare-ech.com`) and the connection to NPMpro will fail, since NPMpro does not have the ECH keys of cloudflare
- Just using cloudflare as a dns nameserver provider for your domain is fine
- If you use cloudflare to forward mails to your inbox, note that cloudflare also acts as man-in-the-middle in this case

## Hints for Your Privacy Policy
**Note: This is not legal advice. The following points are intended to give you hints and help you identify areas that may be relevant to your privacy policy. This list may not be complete or correct.**
1. NPMpro **always** writes the nginx error logs to your Docker logs; it uses the error level “warn” (so every error nginx and the nginx modules mark as error level “warn” or higher will be logged), as it contains user information (like IPs) you should mention it in your privacy policy. With the default installation no user data should leave your system because of NPMpro (except for data sent to your backends, as this is the task of a reverse proxy), this should be the only data created by NPMpro containing user information by default.
2. If you enable `LOGROTATE` the access and error (also level “warn”), logs will be written to your disk and rotated daily and deleted based on your set number of set rotations. The access logs use these formats: [http](https://github.com/TheBlackBush/NPMpro/blob/develop/rootfs/usr/local/nginx/conf/nginx.conf) and [stream](https://github.com/TheBlackBush/NPMpro/blob/develop/rootfs/usr/local/nginx/conf/nginx.conf). These include user information (like IPs), so make sure to also mention that these exist and what you are doing with them.
3. If you use crowdsec, and you do **not** [disable sharing in crowdsec](https://docs.crowdsec.net/docs/next/configuration/crowdsec_configuration/#sharing), you need to mention that [this](https://docs.crowdsec.net/docs/central_api/intro/#signal-meta-data) is sent to crowdsec in your privacy policy.
4. If you're blocking IPs, for example, using access lists, GeoIP filtering, or CrowdSec block lists, make sure to mention this as well.
5. If GoAccess is enabled, it processes access logs to generate statistics, which are saved on disk for a time you can configure. These statistics include user information (like IPs), so make sure to also mention this.
6. If you enable traffic statistics (Settings, Monitoring, or `TRAFFIC_STATS`), NPMpro reads the access log and stores counts per host, status class, country and network (and the bytes sent) for the set retention time. Visitor IPs are only stored if you also enable "Show visitor IPs". If you enable "Count unique visitors" (or `TRAFFIC_UNIQUE_VISITORS`), NPMpro additionally stores a keyed, truncated hash of each visitor IP per host and day (not the IP itself, the key never leaves the server) for the set retention time. The hash depends only on the IP (and the server's key), so the same visitor has the same hash on every host and day for the retention period; this is what lets the 7 and 30 day ranges count a visitor once. The hashes are pseudonymous, not anonymous: whoever can read the data folder (the database and the key both live under `/data`) could test all IPv4 addresses against them and recover the IPs. You may want to mention it, especially if your sites are used by others. The access log itself is written to disk while statistics are on and rotated like with `LOGROTATE`. GeoIP lookups happen locally from the MaxMind database files on disk, no visitor IP is sent to MaxMind.
7. If you use the PHP-FPM option, error logs from PHP-FPM will also be written to Docker logs. These include user information (like IPs), so make sure to also mention this.
8. If you collect any user information (like through other custom nginx modules, modules you can load via env, lua scripts, etc.), also mention it.
9. If you use the caddy http to https redirect container, you should also mention the data collected by it, since it will also collect (error) logs.
10. If use use anubis, see here: https://anubis.techaro.lol/docs/admin/configuration/impressum
11. If you do any extra custom/advanced configuration/modification, which is in someway related to the users data, then yes, keep in mind to also mention this.
12. Anything else you do with the users data, should also be mentioned. (Like what your backend does or any other proxies in front of NPMpro (like cloudflare, still not recommended), how data is stored, duration, ads, analytic tools, how data is handled if they contact you, by who/which provider, etc.)
13. This probably does not need to be mentioned, but you can include it if you want to be thorough (note: this does not apply if you're using Let's Encrypt, as they no longer support OCSP): Some clients (like Firefox) send OCSP requests to the certificate authority (CA) by default if the CA includes OCSP URLs in the certificate. This behavior can be disabled by users in Firefox. It likely does not need to be mentioned, as no data is sent to you, the client communicates directly with the CA. The check is initiated by the client itself; it's neither requested nor required by you. Your certificate simply indicates that the client can perform this check if it chooses to.
14. Also optional and likely not required: Some information about the data stored by the nameservers running your domain. This should not be required, since in most cases there's a provider between the users and your nameserver acting as a proxy. This means the DNS requests of your users are hidden behind their provider. It’s the provider who should explain to their users how they handle data in their role as a "DNS proxy."

## What connections can be expected from the NPMpro container?
- to your clients
- to your upstreams
- to your dns server for name resolution
- to your acme/ocsp server
- to github for an hourly update check
- if not disabled gravatar for profile pictures
- if used to your OIDC
- if used to pypi to download certbot plugins
- if used to your dns provider for acme dns challenges
- if used to www.site24x7.com for the reachability check
- if enabled to the alpine package repositories to install the inbuilt php-fpm and its extensions
- if enabled to cloudflare to download their IPs
- if enabled to the crowdsec (container) lapi (also for the CrowdSec tab of the Monitoring page, the URL is the `API_URL` of the bouncer config)
- if GeoIP credentials are set to download.maxmind.com (and the storage location it redirects to) to download the GeoLite2 databases: when the credentials or editions are changed, when "Update now" is used, and every 3 days (a failed automatic update is retried after 24 hours)
- if enabled to your captcha provider for the crowdsec captcha remediation
- if you see more/others please report them

## Access Lists
When using multiple Access Lists on a Proxy Host or a Proxy Location, they are evaluated in a top-down order from the UI. 
The `Satisfy Any` or `Pass Auth to Upstream` only get applied if they are set on the first Access List assigned to a proxy host/location

## Contributing
All are welcome to create pull requests for this project, but this does not mean that they will be merged, so better ask if your PR would be merged before creating one (via an issue), typos and translations are excluded from this.

## Getting Help
1. [Support, questions and bug reports](https://github.com/TheBlackBush/NPMpro/issues): please open an issue only for questions, feature requests and reproducible bugs

## Credits

NPMpro is based on [NPMplus](https://github.com/ZoeyVid/NPMplus) by ZoeyVid, which is based on [Nginx Proxy Manager](https://github.com/NginxProxyManager/nginx-proxy-manager) by jc21. NPMpro is licensed under AGPL-3.0, with parts under MIT (see COPYING and MIT.LICENSE).
