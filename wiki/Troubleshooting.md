# Troubleshooting

## Where the logs are

- **Docker logs:** `docker logs npmpro` (add `-f` to follow). Start messages, backend messages and the nginx error log (level `warn`) always go here.
- **Log files:** with Write log files on (Settings, Logs & monitoring, or `LOGROTATE=true`), nginx also writes `access.log`, `stream.log` and `error.log` to `/data/nginx/logs` (on the host `/opt/npmpro/nginx/logs` with the default volume). They are rotated daily. With traffic statistics on, `access.log` is written too.
- **Host configs:** `/data/nginx/<type>/<id>.conf`, for example `/data/nginx/proxy_host/3.conf`.

## The container does not start

When a check fails at startup, the container prints the reason and then waits instead of starting. Read `docker logs npmpro`. The common ones:

- **"... env is not supported"** or **"... is replaced by ..."**: you set a variable that was removed. Remove it from `compose.yaml` (and use its replacement): see [Removed variables](https://github.com/TheBlackBush/NPMpro#removed-variables).
- **"... needs to be true or false"**, **"... needs to be a number"** and similar: a variable has an invalid value. The compose file lists the allowed values.
- **"TZ is invalid."**: `TZ` is not a known time zone name. Use a "TZ identifier" such as `Europe/Berlin`, or remove `TZ` and set the time zone in Settings, Advanced.
- **"This docker container must be run as root, do not specify a user. Please use PUID/PGID instead."**: remove `user:` from the service.
- **"/data is not mounted! Check your compose.yaml."**: add the `/data` volume.
- **"You need to recreate the NPMpro container after changing the .env file ..."**: you changed `/data/.env`; run `docker compose up -d --force-recreate`.
- **"The ACME_PROFILE seems to be not supported by the ACME_SERVER."**: the profile set in `ACME_PROFILE` is not offered by your ACME server; change or remove it.
- **PUID/PGID:** `PGID` without `PUID` is refused. With a non-root `PUID`, uncomment `SETUID`, `CHOWN`, `FOWNER` and `DAC_OVERRIDE` in `cap_add`, and with `network_mode: host` you may need `sysctl net.ipv4.ip_unprivileged_port_start=0` to bind ports below 1024.
- **`NGINX_QUIC_BPF=true`** needs the `BPF`, `PERFMON` and `NET_ADMIN` capabilities.
- **Port already in use:** another service (or a second proxy) listens on 80, 443 or 81. Stop it, or change `HTTP_PORT`, `HTTPS_PORT` or `NPM_PORT`.

## A host shows offline or "Config error"

NPMpro tests the nginx config whenever it writes one. If the test fails, the host's config is renamed to `<id>.conf.err`, the host gets a red "Config error" status (click it to see the nginx message), and nginx keeps running with the other hosts.

- The usual cause is custom or advanced config of that host (or a custom location). Fix it and save the host again.
- Without a message from nginx, check the nginx error log in the docker logs.
- If the formatter fails on non-standard custom config, turn off Format nginx configs in Settings, Advanced.

## A certificate request or renewal fails

- **HTTP challenge:** the domain must resolve to your public IP and port 80 must be forwarded to NPMpro. Use the reachability check in the certificate dialog. With `DISABLE_HTTP=true` or a changed `HTTP_PORT` the HTTP challenge may not work; use the DNS challenge instead.
- **DNS challenge:** check the credentials of your provider and give DNS time to update (Propagation Seconds in the dialog). Some providers need a token with write access to the zone.
- **ACME profile:** when you save a profile in Settings, Certificates & TLS, NPMpro asks the ACME server. "The ACME server does not offer this profile" means it is not available there; "Could not check the ACME server profiles" means the server was not reachable.
- **Must-Staple:** Let's Encrypt refuses Must-Staple requests. Turn OCSP Must-Staple off with Let's Encrypt.
- **Rate limits:** Let's Encrypt limits how many certificates you can request; after many failed attempts wait before trying again. See https://letsencrypt.org/docs/rate-limits/.
- **Other CAs:** ZeroSSL and Google Public CA need `ACME_EMAIL`, and Google Public CA also `ACME_EAB_KID` and `ACME_EAB_HMAC_KEY`.
- The backend log in `docker logs npmpro` has the certbot output.

## HTTP/3 does not work

- Expose the https port over udp too (443/udp). With `network_mode: host` this is a firewall or router question.
- Turn on HTTP/3 Support for the host.
- HTTP/3 is off when `DISABLE_H3_QUIC=true` or when the https listener uses the proxy protocol (`LISTEN_PROXY_PROTOCOL` or `LISTEN_PROXY_PROTOCOL_HTTPS`).
- Browsers switch to HTTP/3 only after a first connection over HTTP/2, so reload the page once.

## The logs show the wrong client IPs

If NPMpro sits behind another proxy, load balancer or tunnel, nginx only sees that proxy's IP until you trust it:

- Add the proxy's IP or range to Trusted proxy IPs in Settings, Network (or `TRUST_IP`).
- Behind Cloudflare, turn on Trust Cloudflare (Settings, Network, or `TRUST_CLOUDFLARE=true`), but read the [notes on Cloudflare](https://github.com/TheBlackBush/NPMpro#notes-on-cloudflare) first.
- A proxy that sends the PROXY protocol needs `LISTEN_PROXY_PROTOCOL` (or the `_HTTP` / `_HTTPS` variant).

## OIDC sign-in fails

The sign-in page shows an error code:

| Code | Meaning |
|---|---|
| `not_configured` | OIDC is not fully set up or not enabled |
| `provider_error` | the provider returned an error or could not be reached |
| `no_email` | the provider sent no email address |
| `email_not_verified` | the provider has not verified the email address and Require a verified email is on |
| `no_user` | no account with this email, and Create users on their first sign-in is off |
| `domain_not_allowed` | the email domain is not in the allowed domains |
| `user_disabled` | the account is disabled |

Also check that the callback URL shown in Settings, Authentication is registered at the provider. If the issuer uses a self-signed certificate, `NODE_TLS_REJECT_UNAUTHORIZED=0` turns off certificate checks for every request of the backend, so use it only if there is no other way.

If password sign-in is turned off and OIDC does not work, set `OIDC_DISABLE_PASSWORD=false` and recreate the container.

## Password or MFA reset

```bash
docker exec -it npmpro password-reset.js USER_EMAIL [--disable-mfa]
```

The new password is read from stdin (leave it empty to keep the current one). `--disable-mfa` turns off two-factor authentication. This works with SQLite only.

## Database backup and restore

With SQLite, NPMpro copies the database to `/data/npmpro/backups` before it runs database migrations (the newest 5 copies are kept). To go back to the previous image:

1. Stop the container.
2. Replace `/data/npmpro/database.sqlite` with the backup and remove `database.sqlite-wal` and `database.sqlite-shm` next to it.
3. Start the previous image.

For your own backups, stop the container and copy the whole data folder. It includes `/data/npmpro/dns-credentials.key`, which saved DNS credentials need.

## NPMplus migration checks fail

When NPMpro takes over an NPMplus volume, it checks the copy of `/data/npmplus` before it uses it. If a check fails, the container waits and the log says why; `/data/npmplus` stays unchanged.

- If both `/data/npmplus` and `/data/npmpro` exist and `/data/npmplus/database.sqlite` is newer, NPMpro does not choose: move the folder you do not want out of `/data` and start again.
- Make sure the disk has room for a second copy of the data folder.

See [Upgrading from NPMplus](Upgrading-from-NPMplus).

## Reporting a bug

Open an issue at https://github.com/TheBlackBush/NPMpro/issues with:

- the image tag (or the version in the footer of the web UI)
- what you did and what you expected
- the relevant part of `docker logs npmpro` (remove domains, IPs and keys you do not want to share)
- your `compose.yaml` without secrets
