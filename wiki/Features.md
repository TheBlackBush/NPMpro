# Features

What NPMpro offers, grouped by topic. Each group links to the page that explains it.

## Proxy and hosts
- Proxy hosts, redirection hosts, 404 hosts and streams (TCP/UDP), managed in the web UI
- HTTP/3 (QUIC), needs the https port exposed over udp
- more ways to serve a host: gRPC, proxy protocol, load balancing over several upstreams (see [Load Balancing](Load-balancing)), and serving files or PHP directly with fancyindex support
- zstd and brotli compression in addition to gzip
- punycode domain support
- host configs that are missing on startup are regenerated, even when no variable or template changed

## TLS and certificates
- hardened TLS by default: patched nginx built with aws-lc compiled from source, enforced cipher and curve order, certificate compression (zlib-ng and brotli), optional encrypted client hello ([ECH](Security#encrypted-client-hello-ech))
- short-lived Let's Encrypt certificates by default, plus proper support for other ACME servers (ZeroSSL, Google Public CA, your own) with OCSP stapling and Must-Staple
- DNS challenge with many providers and saved DNS credentials: enter the credentials of a DNS provider once (Certificates, DNS credentials tab) and reuse them; they are stored encrypted with the key `/data/npmpro/dns-credentials.key`. The same key also encrypts the OIDC client secret, the MaxMind license key and the key behind the unique visitor hashes: keep it with your backups (without it saved DNS credentials, the client secret and the license key must be entered again)
- custom certificates can be replaced, and mTLS with client certificates per host

## Security
- [CrowdSec](CrowdSec) support, including AppSec (WAF) and bot detection
- security headers always sent, fingerprinting headers stripped, based on the OWASP secure headers project
- several access lists per host and per location
- a hardened web UI: https, strict CSP, an httpOnly cookie instead of local storage, rate limits and more
- opt-in logging: no log files on disk unless you turn them on

## Authentication
- [OIDC sign-in](Authentication#oidc-login) for the web UI, with automatic account creation on the first sign-in (optional, limited to allowed email domains), a custom sign-in button and an option to turn off password sign-in
- built-in forward authentication (auth_request) for Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia and Authentik, no advanced config needed (see [the examples](Forward-Authentication))
- two-factor authentication (TOTP) for users, password and MFA reset from the command line (SQLite only): `docker exec -it npmpro password-reset.js USER_EMAIL [--disable-mfa]`, the new password is read from stdin

## Monitoring and logs
- a [Monitoring](Monitoring) page with traffic statistics per host (requests, bytes, status classes, countries, networks, optional unique visitors and top IPs) and the active CrowdSec bans
- GeoIP: NPMpro downloads the MaxMind GeoLite2 databases itself (Settings, GeoIP)
- the [GoAccess](Monitoring#goaccess) log report (`/goaccess`) and a Swagger UI (`/api/docs`) for the API, both inside the web UI

## Web UI and operations
- most settings live in the web UI (Settings): certificates and TLS, network, forward authentication, logs and monitoring, GeoIP, authentication, nginx core options (workers, TLS 1.2, curves, modules) and more; an environment variable still wins and locks the field (see [Settings and environment variables](Configuration))
- an Environment page (Settings, Environment) that lists the startup variables read-only, secrets never shown
- audit log, users with per-section permissions, light and dark theme
- database backup before upgrades (SQLite only): before database migrations run, the database is copied to `/data/backups/database` (the newest 5 are kept; a copy holds the secrets the database held at that time, so treat the folder like the database). To go back to the previous image, stop the container, replace `/data/npmpro/database.sqlite` with the backup (remove `database.sqlite-wal` and `database.sqlite-shm` next to it) and start the previous image
- Alpine based, a much smaller image
- many other things, see these wiki pages and the [compose.yaml]((https://github.com/TheBlackBush/NPMpro/blob/develop/compose.yaml))
