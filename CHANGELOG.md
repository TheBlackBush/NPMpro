# Changelog

All notable changes to NPMpro are listed here. The layout follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release takes its section
below as its release notes.

## [Unreleased]

### Added

- **Hosts:** a one-line description on proxy, redirection and 404 hosts and up to 10 tags on every host type, with a
  Tags filter and search in the lists.
- **Hosts:** a custom location with exactly `/.well-known/acme-challenge/` passes the ACME challenges to its own
  target.
- **Landing pages:** NPMpro's own pages in the visitor's language for a ban, a captcha, a 404, an upstream error, the
  default site, a refused access list, maintenance mode and a certificate problem; chosen in Settings, Landing pages,
  per proxy host (Pages tab), per 404 host and per access list, or pasted and uploaded as custom pages.
- **Certificates:** saved, reusable DNS credentials, stored encrypted and shared by several certificates.
- **Certificates:** a clear certificate request progress and the expiry shown on the dashboard and in the list.
- **Certificates:** the DNS providers ip-projects and the new Beget plugin; certbot 5.10.0.
- **Hosts:** tags in the lists get automatic brand colours picked from the tag's name.
- **Sign-in:** OIDC settings in the UI with automatic accounts, a login button with its own name, colour and icon, and
  a link between a user and one OIDC identity (Sign-in column, unlink).
- **Settings:** the runtime settings, the nginx core settings and the nginx module switches (njs, LDAP, NTLM, VTS) in
  the UI; a variable that is set wins and locks the setting, and the Environment page shows every value read-only.
- **CrowdSec:** the bouncer configuration in Settings with a connection test, the admin UI choice (Checked, Bans only,
  Left out) and a safe start when its files are broken.
- **CrowdSec:** log files for CrowdSec parsing: more access and stream log fields, a JSON log format, a TLS handshake
  log and a request id in AppSec alerts, read by the hub parser and scenarios `TheBlackBush/npmpro`.
- **Monitoring:** traffic and CrowdSec statistics in the UI, unique visitors (off by default, keyed hashes), traffic
  per host, recent requests and a world map; an off switch that deletes the stored statistics.
- **Backup and restore:** encrypted backups with a choice of items, replace and merge restore, single items, page
  import and export, scheduled backups with retention, and database moves between SQLite, MySQL or MariaDB and
  PostgreSQL.
- **Interface:** a new interface on shadcn/ui with a top bar, sidebar, command palette and dark mode; tooltips on
  icon buttons and cut text; compact lists on phones; paged lists; a guard for unsaved changes; 13 languages.
- **Installation:** an Unraid template, and every secret variable can be read from a file with `<NAME>_FILE` for
  Docker and Compose secrets.
- **Images:** images for amd64 (x86-64-v2) and arm64 on GHCR and Docker Hub, with an SBOM, provenance and keyless
  cosign signatures.

### Changed

- **Hosts:** saving is safer: a save whose nginx reload fails is kept and says so, streams cannot use NPMpro's own
  ports or ranges wider than 1000 ports, and Pass Auth to Upstream with several access lists needs every list to allow
  it.
- **nginx:** NPMpro's built-in locations take priority over regex locations, and workers are pinned to CPUs only when
  the Pin workers to CPUs setting is on.
- **Data:** the app data lives in `/data/npmpro`; an older data folder is moved there once at the first start, and
  the old folder is kept as a backup.
- **Certificates:** Baidu moves to Baidu AI Cloud DNS, so it needs Baidu AI Cloud keys; the old Beget plugin stays for
  the certificates that already use it.

### Security

- **Container:** the Compose file and the Unraid template drop every capability NPMpro does not need, nginx workers
  run as their own user, `PUID` binds ports below 1024 without a host setting, and certbot and every DNS plugin are
  pinned to a version installed against the image's certbot.
- **Sign-in:** a constant-time login check, a rate limit on sign-in, and stricter validation of upstreams, forward
  authentication and domain names; users who are not administrators cannot set unix socket targets or regex domains.
- **Requests:** a client cannot pass its own `X-Npmpro-Request-Id` to an upstream, and `X-Forwarded-Proto` is taken
  only from trusted proxies.
