# Changelog

All notable changes to NPMpro are listed here. The layout follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release takes its section
below as its release notes.

## [Unreleased]

### Added

- **Certificates:** a Warn before expiry setting (default 14 days, at most a third of a certificate's lifetime, so short-lived certificates no longer show as expiring all the time).
- **Notifications:** an event layer that detects certificate, host, backup, GeoIP, CrowdSec and Dynamic DNS problems and changes, the base of mail and webhook notifications.
- **Notifications:** mail through your SMTP server: Settings, Notifications with a test mail, a public URL for links and a mail language per user.
- **Authentication:** password reset by mail, off by default (Settings, Authentication), with a notice mail after every reset.
- **DNS:** test a saved DNS credential, see where each host name points, clean up leftover ACME challenge records, and a CAA warning in the certificate windows and list.
- **DNS:** dynamic DNS: records under Certificates & DNS, Dynamic DNS keep names pointed at the instance's public IP (address records, or aliases such as a wildcard CNAME to one address record) with the saved Cloudflare, DigitalOcean, Hetzner Cloud and Gandi credentials, with Update now, Check now, history, backups and Settings, Dynamic DNS.
- **DNS:** an opt-in option in the host windows to create a host's DNS record at the provider, kept current by dynamic DNS.
- **DNS:** dynamic DNS for OVH, deSEC, Porkbun and DuckDNS, presets for Namecheap, No-IP and Dynu, a custom HTTP updater for administrators, and suggestions of host names to keep updated.
- **DNS:** Domain Names fields suggest the DNS domains of your credentials and the names hosts and certificates use, and the DNS challenge suggests the credential whose domains cover the names.
- **DNS:** DNS credentials know the domains (zones) they manage: a Domains tab under Certificates & DNS, a Domains line in the credential window, and domains in backups.
- **DNS:** fetch the domains of a Cloudflare, DigitalOcean, Hetzner Cloud, Gandi, OVH, PowerDNS, Linode, Vultr, deSEC, bunny.net,
  Porkbun, IONOS or GoDaddy credential from the provider.
- **Certificates:** the ACME account in Settings, Certificates as a connection: a status card (Connected, Waiting, Failed or Not
  connected) with Change, Try again and Connect, and a Connect window for the CA (Let's Encrypt, ZeroSSL, Google Trust
  Services or a directory URL), email and EAB keys; Replace account is a button next to Change. The ACME profile is a
  list of the profiles the CA offers. A set `ACME_*` variable locks its field.
- **Certificates:** request a certificate from another CA than the instance default (administrators add CAs under Other
  CAs in Settings, Certificates), see each certificate's CA in the list, and re-issue a certificate on another CA (the
  old certificate is revoked, except on a re-issue to Let's Encrypt staging, which the window warns about).
- **Certificates:** edit the domain names of an ACME certificate (Edit in its row); it is requested again under the same
  entry, the window warns about names hosts still use, and a failure changes nothing.
- **Hosts:** a one-line description on proxy, redirection and 404 hosts and up to 10 tags on every host type, shown in
  automatic brand colours picked from the tag's name, with a Tags filter and search in the lists.
- **Hosts:** a custom location with exactly `/.well-known/acme-challenge/` passes the ACME challenges to its own
  target.
- **Landing pages:** NPMpro's own pages in the visitor's language for a ban, a captcha, a 404, an upstream error, the
  default site, a refused access list, maintenance mode and a certificate problem; chosen in Settings, Landing pages,
  per proxy host (Pages tab), per 404 host and per access list, or pasted and uploaded as custom pages.
- **Certificates:** saved, reusable DNS credentials, stored encrypted and shared by several certificates.
- **Certificates:** a clear certificate request progress and the expiry shown on the dashboard and in the list.
- **Certificates:** the DNS providers ip-projects and the new Beget plugin; certbot 5.10.0.
- **Sign-in:** OIDC settings in the UI with automatic accounts, a login button with its own name, colour and icon, and
  a link between a user and one OIDC identity (Sign-in column, unlink).
- **Settings:** the runtime settings, the nginx core settings and the nginx module switches (njs, LDAP, NTLM, VTS) in
  the UI; a variable that is set wins and locks the setting, and the Environment page shows every value read-only.
- **CrowdSec:** the bouncer configuration in Settings with a connection test, the admin UI choice (Checked, Bans only,
  Left out) and a safe start when its files are broken.
- **CrowdSec:** log files for CrowdSec parsing: more access and stream log fields, a JSON log format, a TLS handshake
  log and a request id in AppSec alerts, for NPMpro's own CrowdSec parser and scenarios (submitted to the CrowdSec hub
  as `TheBlackBush/npmpro`).
- **CrowdSec:** `scripts/crowdsec-npmpro.sh` installs NPMpro's parser, scenarios and alert context into the CrowdSec
  container as local items until they are on the CrowdSec hub (`--remove` takes them out again).
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
- **API:** API tokens for scripts, sent as `Authorization: Bearer`, with their own permissions that never exceed their
  owner's; they work with OIDC-only sign-in and MFA, are stored as a hash and never in backups.
- **API:** API tokens in the Account window (a compact new token form with expiry and permissions capped at your own,
  the token shown once with its header and the Claude Code command to copy, revoke) and every token in Settings, API
  access, with the API reference, the authentication header and the MCP client setup.
- **Account:** one Account window for your profile, password, MFA and API tokens, opened from the one Account entry of the
  user menu; edits stay when switching parts and closing asks before discarding them. Administrators edit another user
  in the same window, with Profile and a Sign-in part.
- **MCP:** an MCP server at `/api/mcp` for AI assistants, using API tokens: 28 tools for hosts, access
  lists, certificates, monitoring and the audit log, limited to the token's permissions; delete tools only with the
  token's Allow delete switch.
- **API:** the API reference at `/api-reference` (also from `/api/docs`) describes every route and field with examples,
  in three columns: the routes with a search, what each route does and needs, and its curl, Node and Python code with
  Try it as you or as a pasted token; it starts with a Getting started guide and follows the app's light or dark theme.
- **nginx:** the DNS resolver nginx uses for upstream names is a setting (Settings, nginx, DNS resolver, or `NGINX_RESOLVER`, `NGINX_RESOLVER_HOSTS`, `NGINX_RESOLVER_IPV6`, `NGINX_RESOLVER_VALID`).

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
- **Landing pages:** the visit time on the built-in pages can show the visitor's local time, or local time with UTC
  (Settings, Landing pages, Page details); UTC stays the default.
- **Certificates:** the container starts without a reachable ACME server: the account registers at the first
  certificate request, renewals keep the CA that issued each certificate, and the profile and OCSP Must-Staple apply
  per CA.

### Security

- **Container:** the Compose file and the Unraid template drop every capability NPMpro does not need, nginx workers
  run as their own user, `PUID` binds ports below 1024 without a host setting, and certbot and every DNS plugin are
  pinned and checked against the image's certbot.
- **Sign-in:** a constant-time login check, a rate limit on sign-in, and stricter validation of upstreams, forward
  authentication and domain names; users who are not administrators cannot set unix socket targets or regex domains.
- **Requests:** a client cannot pass its own `X-Npmpro-Request-Id` to an upstream, and `X-Forwarded-Proto` is taken
  only from trusted proxies.
- **Access lists:** the API no longer returns the basic-auth users' password hashes.
