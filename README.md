<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/images/brand/npmpro-stacked-dark.svg">
    <img src=".github/images/brand/npmpro-stacked-light.svg" alt="NPMpro" width="300">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/TheBlackBush/NPMpro/actions/workflows/docker.yml"><img src="https://img.shields.io/github/actions/workflow/status/TheBlackBush/NPMpro/docker.yml?branch=develop&style=for-the-badge&label=docker%20build" alt="Docker build"></a>
  <a href="https://github.com/TheBlackBush/NPMpro/actions/workflows/test.yml"><img src="https://img.shields.io/github/actions/workflow/status/TheBlackBush/NPMpro/test.yml?branch=develop&style=for-the-badge&label=tests" alt="Tests"></a>
  <a href="COPYING"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=for-the-badge" alt="License AGPL-3.0"></a>
  <a href="https://github.com/TheBlackBush/NPMpro/pkgs/container/npmpro"><img src="https://img.shields.io/badge/image-npmpro-blue?style=for-the-badge&logo=github" alt="GHCR package"></a>
  <a href="https://github.com/TheBlackBush/NPMpro/pkgs/container/npmpro"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fghcr-badge.elias.eu.org%2Fapi%2FTheBlackBush%2FNPMpro%2Fnpmpro&query=downloadCount&label=ghcr%20pulls&style=for-the-badge&logo=docker&logoColor=white" alt="GHCR pulls"></a>
  <a href="https://hub.docker.com/r/blackbush/npmpro"><img src="https://img.shields.io/docker/pulls/blackbush/npmpro?style=for-the-badge&logo=docker&logoColor=white&label=docker%20hub%20pulls" alt="Docker Hub pulls"></a>
  <img src="https://img.shields.io/badge/platforms-amd64v2%20%7C%20arm64-informational?style=for-the-badge" alt="Platforms amd64v2 and arm64">
  <a href="https://ko-fi.com/M4M11W3R7J"><img src="https://img.shields.io/badge/support_me_on_ko--fi-F16061?style=for-the-badge&logo=kofi&logoColor=f5f5f5" alt="Ko-fi"></a>
</p>

NPMpro is a reverse proxy with a web UI: you add your domains, point them at your services and get HTTPS certificates, without writing nginx configs.
It is a hardened fork of nginx-proxy-manager (see [License and credits](#license-and-credits)) and ships as one Docker image with a custom-compiled nginx (HTTP/3, brotli/zstd, lua, njs, ECH), a Node.js backend and a React web UI.

![NPMpro dashboard](.github/images/dashboard.png)

Images: `ghcr.io/theblackbush/npmpro` and `blackbush/npmpro` (tags: `latest`, `develop` and version tags like `1.0.0`). If you do not need a web UI, have a look at [caddy](https://caddyserver.com).

## Features

- **Hosts:** proxy hosts, redirection hosts, 404 hosts and TCP/UDP streams, with HTTP/3, gRPC, load balancing, serving files or PHP, zstd and brotli ([Features](https://github.com/TheBlackBush/NPMpro/wiki/Features), [Host options](https://github.com/TheBlackBush/NPMpro/wiki/Host-options), [Load balancing](https://github.com/TheBlackBush/NPMpro/wiki/Load-balancing), [PHP](https://github.com/TheBlackBush/NPMpro/wiki/PHP))
- **Certificates:** short-lived Let's Encrypt certificates by default, other ACME servers, DNS challenge with saved credentials, custom certificates and mTLS ([Usage](https://github.com/TheBlackBush/NPMpro/wiki/Usage#certificates))
- **Hardened TLS:** aws-lc, enforced ciphers and curves, optional Encrypted Client Hello ([Security](https://github.com/TheBlackBush/NPMpro/wiki/Security))
- **CrowdSec:** blocking with AppSec (WAF) and bot detection ([CrowdSec](https://github.com/TheBlackBush/NPMpro/wiki/CrowdSec))
- **Forward authentication:** built in for Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia and Authentik ([Forward authentication](https://github.com/TheBlackBush/NPMpro/wiki/Forward-Authentication))
- **Web UI sign-in:** OIDC, two-factor authentication (TOTP) and users with per-section permissions ([Authentication](https://github.com/TheBlackBush/NPMpro/wiki/Authentication))
- **Access lists:** several per host and per location ([Usage](https://github.com/TheBlackBush/NPMpro/wiki/Usage#access-lists))
- **Settings in the web UI:** nearly every option, with an environment variable that wins and locks the field ([Configuration](https://github.com/TheBlackBush/NPMpro/wiki/Configuration))
- **Monitoring:** traffic statistics per host, GeoIP, active CrowdSec bans and a GoAccess report ([Monitoring](https://github.com/TheBlackBush/NPMpro/wiki/Monitoring))
- **Backup and restore:** one encrypted file, merge and per-page import and export, scheduled backups ([Backup and restore](https://github.com/TheBlackBush/NPMpro/wiki/Backup-and-restore))
- **Databases:** SQLite by default, with a built-in move to MySQL/MariaDB or PostgreSQL ([Database](https://github.com/TheBlackBush/NPMpro/wiki/Database))
- **Privacy:** no log files on disk unless you turn them on ([Privacy](https://github.com/TheBlackBush/NPMpro/wiki/Privacy))
- **Small image:** Alpine based, for amd64v2 and arm64 ([Compatibility](https://github.com/TheBlackBush/NPMpro/wiki/Compatibility))

## Quick start

1. Install Docker and Docker Compose ([Docker](https://docs.docker.com/engine/install), [Compose](https://docs.docker.com/compose/install/linux)).
2. Download the [compose.yaml](https://raw.githubusercontent.com/TheBlackBush/NPMpro/refs/heads/develop/compose.yaml) and set `TZ` to your time zone.
3. Set `COOKIE_SECRET` to a random value (`openssl rand -hex 32`) and keep it, otherwise every restart signs all users out ([why and how](https://github.com/TheBlackBush/NPMpro/wiki/Configuration#cookie_secret)).
4. Start it:
```bash
docker compose up -d
```
5. Open `https://<server-ip>:81` (your browser warns about the placeholder certificate) and create your admin account.

Expose 80/tcp, 443/tcp and 443/udp (HTTP/3) for your hosts. Requirements, the first steps and reverse proxying the web UI itself: [Installation](https://github.com/TheBlackBush/NPMpro/wiki/Installation).

## Documentation

The documentation is in the [wiki](https://github.com/TheBlackBush/NPMpro/wiki).

- Getting started: [Installation](https://github.com/TheBlackBush/NPMpro/wiki/Installation), [Configuration](https://github.com/TheBlackBush/NPMpro/wiki/Configuration), [Usage](https://github.com/TheBlackBush/NPMpro/wiki/Usage), [Features](https://github.com/TheBlackBush/NPMpro/wiki/Features)
- Security and access: [Security](https://github.com/TheBlackBush/NPMpro/wiki/Security), [CrowdSec](https://github.com/TheBlackBush/NPMpro/wiki/CrowdSec), [Authentication](https://github.com/TheBlackBush/NPMpro/wiki/Authentication), [Forward authentication](https://github.com/TheBlackBush/NPMpro/wiki/Forward-Authentication), [Privacy](https://github.com/TheBlackBush/NPMpro/wiki/Privacy)
- Hosts and traffic: [Host options](https://github.com/TheBlackBush/NPMpro/wiki/Host-options), [Load balancing](https://github.com/TheBlackBush/NPMpro/wiki/Load-balancing), [PHP](https://github.com/TheBlackBush/NPMpro/wiki/PHP), [Monitoring](https://github.com/TheBlackBush/NPMpro/wiki/Monitoring)
- Data and operations: [Backup and restore](https://github.com/TheBlackBush/NPMpro/wiki/Backup-and-restore), [Database](https://github.com/TheBlackBush/NPMpro/wiki/Database), [Troubleshooting](https://github.com/TheBlackBush/NPMpro/wiki/Troubleshooting)
- Upgrading: [Upgrade notes](https://github.com/TheBlackBush/NPMpro/wiki/Upgrade-notes), [Compatibility](https://github.com/TheBlackBush/NPMpro/wiki/Compatibility), [Upgrading from NPMplus](https://github.com/TheBlackBush/NPMpro/wiki/Upgrading-from-NPMplus), [Migrating from Nginx Proxy Manager](https://github.com/TheBlackBush/NPMpro/wiki/Migrating-from-Nginx-Proxy-Manager)

## Good to know

- **Certificates:** by running NPMpro you agree to the ToS of Let's Encrypt or your custom CA.
- **HTTP/3:** expose the https port over udp too (443/udp).
- **HSTS:** add your domain to the [HSTS preload list](https://hstspreload.org) if you enabled HSTS for it.

## Contributing
All are welcome to create pull requests for this project, but this does not mean that they will be merged, so better ask if your PR would be merged before creating one (via an issue), typos and translations are excluded from this.

## Getting Help
[Support, questions and bug reports](https://github.com/TheBlackBush/NPMpro/issues): please open an issue only for questions, feature requests and reproducible bugs.

## License and credits

NPMpro is licensed under the GNU Affero General Public License version 3 or any later version (see COPYING), with parts under MIT (see MIT.LICENSE).

NPMpro is based on [NPMplus](https://github.com/ZoeyVid/NPMplus) by ZoeyVid, which is based on [Nginx Proxy Manager](https://github.com/NginxProxyManager/nginx-proxy-manager) by jc21.
