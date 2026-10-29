# NPMpro wiki

NPMpro is a reverse proxy with a web UI: you add your domains, point them at your services and get HTTPS certificates, without writing nginx configs. It is a hardened fork of nginx-proxy-manager and ships as one Docker image.

These pages cover setup and daily use. The [README](https://github.com/TheBlackBush/NPMpro#readme) stays the reference for the features, the settings and environment variables, CrowdSec, forward authentication, load balancing, ECH, geoblocking and the privacy hints.

## Pages

- [Installation](Installation): requirements, the compose file, the first start
- [Usage](Usage): hosts, certificates, access lists, streams, settings, monitoring, users
- [CrowdSec](CrowdSec): blocking attackers with CrowdSec and AppSec, step by step
- [Forward authentication](Forward-Authentication): a login or bot check in front of your services with Anubis, Tinyauth, oauth2-proxy, VoidAuth, Authelia or authentik
- [Backup and restore](Backup-and-restore): saving hosts, certificates, users and settings to a file and restoring them, and scheduled backups
- [Database](Database): the database in use and moving between SQLite, MySQL/MariaDB and PostgreSQL
- [Troubleshooting](Troubleshooting): logs, start problems, certificates, HTTP/3, client IPs, resets, backups and database moves
- [Upgrading from NPMplus](Upgrading-from-NPMplus): taking over an NPMplus data volume
- [Migrating from Nginx Proxy Manager](Migrating-from-Nginx-Proxy-Manager): moving from the original project

## Getting help

Questions, feature requests and reproducible bugs: https://github.com/TheBlackBush/NPMpro/issues
