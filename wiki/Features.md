# Features

What NPMpro offers, grouped by topic. Each group links to the page that explains it.

## Proxy and hosts
- Proxy hosts, redirection hosts, 404 hosts and streams (TCP/UDP), managed in the web UI; Clone in a host's menu opens a new host with its settings (without the domain names, or a stream's incoming port, which must be unique)
- A stream's incoming port is a port from 1 to 65535 or a range such as `8000-8010` (lowest first). It must be unique per protocol: a second enabled stream cannot use a port (or overlap a range) another enabled stream has for TCP or for UDP, but TCP and UDP may share one port. A disabled stream is checked when you enable it.
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

## DNS
- DNS domains: each saved DNS credential knows the domains (zones) it manages, in the Domains tab of Certificates & DNS and in the credential window ([Domains](DNS#domains))
- Fetch domains: for Cloudflare, DigitalOcean, Hetzner Cloud, Gandi, OVH, PowerDNS, Linode, Vultr, deSEC, bunny.net, Porkbun, IONOS and GoDaddy credentials the Add domains window lists the provider's zones to tick ([Domains from the provider](DNS#domains-from-the-provider))
- suggestions while you type: Domain Names fields offer names under your domains and the names your hosts and certificates use, and the DNS challenge suggests the credential whose domains cover the names ([Suggestions while you type](DNS#suggestions-while-you-type), [DNS challenge](DNS#dns-challenge))
- dynamic DNS: records under Certificates & DNS, Dynamic DNS keep a name pointed at the public IP of this instance, so a connection with a changing address stays reachable ([Dynamic DNS](DNS#dynamic-dns)):
  - address records (A, AAAA; IPv4, IPv6 or both, with an optional IPv6 suffix for one host) and alias records (CNAME), for example one address record plus a wildcard alias `*.example.com` pointing at it; wildcard names on Cloudflare and DigitalOcean
  - with a saved DNS credential: Cloudflare, DigitalOcean, Hetzner Cloud, Gandi, OVH, deSEC, DuckDNS and Porkbun; with their own account details: the presets Namecheap, No-IP and Dynu; for administrators a Custom HTTP updater that calls a URL you set ([Providers](DNS#providers))
  - Keep updated suggests the host names that a record could keep updated, on the Dynamic DNS tab and in the proxy host window ([Keep updated](DNS#keep-updated))
  - a check on a schedule that writes only when the record at the provider needs it, Check now and Update now, a history per record, waits a provider asks for, and a stop after a refused account until you act ([The check](DNS#the-check), [History and states](DNS#history-and-states))
  - settings in Settings, Dynamic DNS or as `DDNS_*` variables ([Configuration](Configuration)); records travel in backups, and passwords and custom URLs only in a backup with secrets ([Backup and restore](Backup-and-restore))
- the DNS resolver nginx uses for upstream names, in Settings or with the `NGINX_RESOLVER*` variables ([DNS resolver](DNS#dns-resolver))
- which provider supports which feature: [DNS providers](DNS-providers)

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
- the [GoAccess](Monitoring#goaccess) log report (`/goaccess`) and the API reference (`/api-reference`), both inside
  the web UI

## Web UI and operations
- most settings live in the web UI (Settings): certificates and TLS, network, forward authentication, logs and monitoring, GeoIP, authentication, nginx core options (workers, TLS 1.2, curves, modules) and more; an environment variable still wins and locks the field (see [Settings and environment variables](Configuration))
- an Environment page (Settings, Environment) that lists the startup variables read-only, secrets never shown
- audit log, users with per-section permissions, a light, dark or system theme (System follows the operating system), a top bar or sidebar layout, dialogs or side sheets for editing, and a Ctrl+K command palette (see [Appearance and navigation](Usage#appearance-and-navigation))
- database backup before upgrades (SQLite only): before database migrations run, the database is copied to `/data/backups/database` (the newest 5 are kept; a copy holds the secrets the database held at that time, so treat the folder like the database). To go back to the previous image, stop the container, replace `/data/npmpro/database.sqlite` with the backup (remove `database.sqlite-wal` and `database.sqlite-shm` next to it) and start the previous image
- Alpine based, a much smaller image
- many other things, see these wiki pages and the [compose.yaml](https://github.com/TheBlackBush/NPMpro/blob/develop/compose.yaml)
