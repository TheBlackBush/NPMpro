# Upgrade notes

Notes for installs that update to a newer NPMpro, and the variables that are not supported anymore. Taking over an NPMplus data volume is on its own page: [Upgrading from NPMplus](Upgrading-from-NPMplus). Moving from the original project: [Migrating from Nginx Proxy Manager](Migrating-from-Nginx-Proxy-Manager).

## Upgrade notes

For installs that update to this version:

- **One full regeneration of the host configs** on the first start (the template version changed to 22). The log says "At least one env or the template version changed, all hosts will be regenerated".
- **Error log level:** with Write log files on (`LOGROTATE=true`), `error.log` on disk is written at level `warn` instead of `info`, the same level as the docker logs.
- **Forward authentication upstreams** may not contain whitespace or any of `; { } # " ' $ \`. A proxy host or location that has such an upstream saved keeps working, but fails validation the next time you edit it: correct the value then. The same rule applies to the `AUTH_REQUEST_*_UPSTREAM` variables, which stop the container from starting.
- **Streams:** a second enabled stream on the same incoming port (or an overlapping range) and protocol is refused when you save or enable it, TCP and UDP may still share a port. A stream's forwarding port must be empty, `$server_port` or a port from 1 to 65535; a value that is already stored stays until you change it. A `$` in the forward host of a proxy host, a custom location or a stream is refused for users who are not administrators; a value an administrator already stored stays until it is changed.
- **`TZ` is no longer required.** Without it the Time zone setting (Settings, Advanced) is used, and UTC when that was never saved. An invalid `TZ` still stops the container from starting.
- **`LOGROTATE` and `GOA` no longer turn on traffic statistics.** Write log files and GoAccess keep the access log on disk, but traffic statistics follow only their own setting or `TRAFFIC_STATS`. If you relied on `LOGROTATE=true` (or GoAccess) for the Monitoring page, set `TRAFFIC_STATS=true` or switch Traffic statistics on once under Settings, Logs & monitoring. The statistics stored so far are kept.
- **Smaller image:** bash tab completion and Python's `ensurepip` are no longer in the image. `bash`, `nano`, `curl`, `jq`, `openssl` and the util-linux tools are still there. A prerun script that needs a removed tool installs it with `apk add`.
- **nginx debug logging:** nginx in the image is built without debug support. A custom config (for example `custom_nginx/http_top.conf` or the advanced config of a host) with `debug_connection` gets the warning `"debug_connection" is ignored, you need to rebuild nginx using --with-debug option` and the directive is ignored; `nginx -t` still passes. `error_log ... debug` is accepted and logs like `info`.
- **Alpine packages:** the Alpine packages in the image are refreshed weekly, so an update to an Alpine package reaches the image within a week.
- Settings that were variables only are now in the web UI. Your variables keep working and lock their fields, so nothing changes until you remove them from `compose.yaml`.
- **MySQL: host names differing only in case:** the check for a name that is already in use now ignores case on MySQL and MariaDB, as it already did on SQLite and Postgres. A second host whose name differs only in case from an existing one is refused when you create or edit it; hosts already stored are not changed.
- **Host names that nginx serves under one name:** a save or an enable now refuses a domain name another host already uses when the two differ only by non-ASCII letter case (for example `Ä.example.com` and `ä.example.com`) or when the other host has it as a regular expression server name (`~^...`), as nginx would serve both under one name. Hosts already stored are not changed.
- **Two users with the same email address:** an old database can hold two users whose addresses differ only in case or surrounding spaces. Only one of them could sign in. On the first start the user that signs in (an enabled user before a disabled one, then the lowest id) keeps the address, and every other user gets `name+dup-<id>@domain`. The log says "shared an email address with another user" with the ids of the users concerned, so you can tell them or change the address under Users. Nothing changes without such a pair.
- **Profile pictures:** a user without a real picture now gets their initials on a colour drawn by NPMpro, also with Gravatar on (Gravatar is only asked for a real photo). A picture already stored (including Gravatar's own initials picture) changes the next time it is refreshed: when the user is saved (Users, or Edit profile), also when the user is created (including the first OIDC sign-in). Every save refreshes it, not only one that changes the email address. Pictures you uploaded yourself are kept.
- **Traffic statistics:** on the first start a migration fills an all-hosts total of the stored traffic statistics once. The log says "[traffic_totals] ... written in N batches" and then "traffic totals written". With a lot of stored statistics this takes a moment (about 2 seconds for 200 hosts and 30 days in the benchmark). The stored statistics take about twice the space, and the all-hosts views on the Monitoring page load much faster (30 days for 200 hosts: about 1.3 s before, 0.2 s now).

## Database copy before upgrades

On SQLite, before database migrations run, the database is copied to `/data/backups/database` (the newest 5 are kept; a copy holds the secrets the database held at that time, so treat the folder like the database). To go back to the previous image, stop the container, replace `/data/npmpro/database.sqlite` with the backup (remove `database.sqlite-wal` and `database.sqlite-shm` next to it) and start the previous image.

## Removed variables

These variables are not supported anymore. If one is set, the container does not start and prints the message in its log. Remove it (and use the replacement if there is one):

| Variable | Replacement |
|---|---|
| `NPM_DISABLE_IPV6` | `DISABLE_IPV6`, which now also turns off IPv6 for the web UI |
| `GOA_DISABLE_IPV6`, `GOA_PORT`, `GOA_IPV4_BINDING`, `GOA_IPV6_BINDING`, `GOA_LISTEN_LOCALHOST` | none: GoAccess is served under `/goaccess` of the web UI |
| `NIBEP`, `GOAIWSP` | none: NPMpro uses a unix socket |
| `IPRT` | none: NPMpro only updates and reloads when needed |
| `NGINX_HSTS_SUBDMAINS`, `NGINX_HSTS_SUBDOMAINS` | the HSTS subdomains option of each host in the web UI |
| `HTTP3_ALT_SVC_PORT` | none: the request port (443 when empty) is used |
| `NGINX_LOAD_FANCYINDEX_MODULE` | none: the module is always loaded |
| `NGINX_LOAD_OPENTELEMETRY_MODULE`, `NGINX_LOAD_GEOIP_MODULE`, `NGINX_LOAD_OPENAPPSEC_ATTACHMENT_MODULE` | none: the module was removed |
| `NGINX_LOAD_GEOIP2_MODULE` | none: the geoip module replaced it and is always loaded, see [Geoblocking](Security#geoblocking) for the new config |
| `FULLCLEAN`, `NGINX_DISABLE_PROXY_BUFFERING`, `NGINX_404_REDIRECT`, `AUTH_REQUEST_AUTHENTIK_DOMAIN`, `AUTH_REQUEST_TINYAUTH_DOMAIN` | none |
| `SKIP_IP_RANGES`, `IP_RANGES_FETCH_ENABLED` | `TRUST_CLOUDFLARE` (or Trust Cloudflare in Settings, Network) |
| `CRT` | `CERTBOT_RUN_INTERVAL` (or Renewal check interval in Settings, Certificates & TLS) |
| `LE_SERVER`, `LE_STAGING` | `ACME_SERVER` |
| `NPM_ADMIN_PORT` | `NPM_PORT` |
| `DB_SQLITE_FILE` | none: the database has to be `/data/npmpro/database.sqlite` |
| `X_FRAME_OPTIONS` | the X-Frame-Options option of each host in the web UI |
| `DISABLE_RESOLVER`, `DEBUG`, `SKIP_CERTBOT_OWNERSHIP` | none |
