# Upgrading from NPMplus

NPMpro can take over an existing NPMplus data volume. Paths like `/data/...` are paths inside the container; on the host, `/data` is the folder you mounted to it (for example `/opt/npmplus`).

## Before you start

- Make a backup of the data folder (`cp -a` of the stopped container's folder is enough).
- With an external database (MySQL/MariaDB via `DB_MYSQL_*`, Postgres via `DB_POSTGRES_*`), dump the database. It is renamed in place and is not part of the data folder backup. External databases need MySQL 8.0 or later or MariaDB 10.5.2 or later (any supported Postgres version works).
- Take the [compose.yaml](https://github.com/TheBlackBush/NPMpro/blob/develop/compose.yaml) of NPMpro and keep your volume path and variables. Variables that NPMpro no longer supports stop the container with a message: see [Removed variables](https://github.com/TheBlackBush/NPMpro#removed-variables).

## What happens on the first start

- NPMpro copies `/data/npmplus` to `/data/npmpro`, checks the copy (content comparison and, for SQLite, a database integrity check) and renames the old folder to `/data/npmplus.backup-<date>`, with a `MOVED-TO-NPMPRO.txt` note inside.
- If a check fails, the container stops starting and waits, showing the reason in the logs, and `/data/npmplus` stays unchanged.
- If both `/data/npmplus` and `/data/npmpro` exist, NPMpro keeps `/data/npmpro`, unless `/data/npmplus/database.sqlite` is newer: then it changes nothing, waits, and asks you to move the folder you do not want out of `/data`.
- The database is then migrated: tables and columns named `npmplus_*` become `npmpro_*`. NPMplus images cannot use the migrated database.
- All host configs are regenerated once.

## After the upgrade

- The host path of the volume does not matter to NPMpro. You can keep `/opt/npmplus`, or rename it to `/opt/npmpro` while the container is stopped and change the volume line in `compose.yaml` to match (`/opt/npmpro:/data`).
- Users stay signed in only if you already set a static `COOKIE_SECRET` for NPMplus and keep it; otherwise everyone signs in again, and without one after every restart too (set one now to avoid that). An OIDC login that is in progress during the upgrade has to be started again.
- Many variables are now settings in the web UI. Your variables keep working and lock their fields; remove them from `compose.yaml` when you prefer to manage the setting in the UI.
- Once everything works, delete `/data/npmplus.backup-<date>`: it holds the NPMplus database with the DNS provider credentials in plaintext (NPMpro stores them encrypted) and the old signing key. The same goes for the database copies in `/data/backups/database` made before the upgrade. Until then the container log reminds you on every start.

## Going back to NPMplus

Stop the container, move `/data/npmpro` away, rename `/data/npmplus.backup-<date>` back to `/data/npmplus` and start the NPMplus image. This only restores SQLite installs, because their database lives in that folder. With an external database, also restore the dump you made before upgrading.

If the migration checks fail, see [Troubleshooting](Troubleshooting#npmplus-migration-checks-fail).
