# NPMpro wiki

NPMpro is a reverse proxy with a web UI: you add your domains, point them at your services and get HTTPS certificates, without writing nginx configs. It is a hardened fork of nginx-proxy-manager and ships as one Docker image.

This wiki is the documentation. The [README](https://github.com/TheBlackBush/NPMpro#readme) is only a short introduction.

## Getting started

- [Installation](Installation): requirements, the compose file, the first start
- [Configuration](Configuration): every setting and environment variable, and `COOKIE_SECRET`
- [Usage](Usage): hosts, certificates, access lists, streams, settings, users
- [Features](Features): what NPMpro offers, grouped by topic

## Security and access

- [Security](Security): hardening, ECH, geoblocking and notes on Cloudflare
- [CrowdSec](CrowdSec): blocking attackers with CrowdSec and AppSec, step by step
- [Authentication](Authentication): signing in to the web UI, two-factor authentication and OIDC
- [Forward authentication](Forward-Authentication): a login or bot check in front of your services with Anubis, Tinyauth, oauth2-proxy, VoidAuth, Authelia or authentik
- [Privacy](Privacy): hints for your privacy policy and the connections the container makes

## Hosts and traffic

- [Host options](Host-options): notes on the options of hosts and streams
- [Load balancing](Load-balancing): several upstream servers behind one host
- [PHP](PHP): serving PHP with an external or the built-in php-fpm
- [Monitoring](Monitoring): traffic statistics, GeoIP, active CrowdSec bans and the GoAccess report

## Data and operations

- [Backup and restore](Backup-and-restore): saving hosts, certificates, users and settings to a file and restoring them, and scheduled backups
- [Database](Database): the database in use and moving between SQLite, MySQL/MariaDB and PostgreSQL
- [Troubleshooting](Troubleshooting): logs, start problems, certificates, HTTP/3, client IPs, resets, backups and database moves

## Upgrading and migrating

- [Upgrade notes](Upgrade-notes): what changed for installs that update, and removed variables
- [Compatibility](Compatibility): differences to the upstream project and what NPMpro needs to run
- [Upgrading from NPMplus](Upgrading-from-NPMplus): taking over an NPMplus data volume
- [Migrating from Nginx Proxy Manager](Migrating-from-Nginx-Proxy-Manager): moving from the original project

## Getting help

Questions, feature requests and reproducible bugs: https://github.com/TheBlackBush/NPMpro/issues
