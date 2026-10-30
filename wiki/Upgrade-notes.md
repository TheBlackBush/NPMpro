# Upgrade notes

Notes for installs that update to a newer NPMpro, and the variables that are not supported anymore. Taking over an NPMplus data volume is on its own page: [Upgrading from NPMplus](Upgrading-from-NPMplus). Moving from the original project: [Migrating from Nginx Proxy Manager](Migrating-from-Nginx-Proxy-Manager).

## Upgrade notes

For installs that update to this version:

- **One full regeneration of the host configs** on the first start (the template version changed to 22). The log says "At least one env or the template version changed, all hosts will be regenerated".
- **Error log level:** with Write log files on (`LOGROTATE=true`), `error.log` on disk is written at level `warn` instead of `info`, the same level as the docker logs.
- **Forward authentication upstreams** may not contain whitespace or any of `; { } # " ' $ \`. A proxy host or location that has such an upstream saved keeps working, but fails validation the next time you edit it: correct the value then. The same rule applies to the `AUTH_REQUEST_*_UPSTREAM` variables, which stop the container from starting.
- **`TZ` is no longer required.** Without it the Time zone setting (Settings, Advanced) is used, and UTC when that was never saved. An invalid `TZ` still stops the container from starting.
- **`LOGROTATE` and `GOA` no longer turn on traffic statistics.** Write log files and GoAccess keep the access log on disk, but traffic statistics follow only their own setting or `TRAFFIC_STATS`. If you relied on `LOGROTATE=true` (or GoAccess) for the Monitoring page, set `TRAFFIC_STATS=true` or switch Traffic statistics on once under Settings, Logs & monitoring. The statistics stored so far are kept.
- Settings that were variables only are now in the web UI. Your variables keep working and lock their fields, so nothing changes until you remove them from `compose.yaml`.

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
