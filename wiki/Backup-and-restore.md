# Backup and restore

NPMpro saves your hosts, certificates, users and settings to a single `.npmpro` file and restores them on the same or another instance (SQLite, MySQL/MariaDB or Postgres). You find it under Settings, Backup and restore; only administrators see it. The [README](https://github.com/TheBlackBush/NPMpro#backup-and-restore) has the full reference.

## What a backup holds

- Hosts: proxy hosts (with their custom locations and access list links), redirection hosts, 404 hosts and streams
- Certificates: Let's Encrypt, custom and mTLS CA certificates with their files
- Access lists, DNS credentials and users
- Settings: runtime settings, default site, OIDC sign-in, monitoring and GeoIP
- Custom files: everything in `custom_nginx/` and the CrowdSec files `crowdsec.conf`, `ban.html` and `captcha.html`

A backup never holds traffic statistics, logs, the audit log, sessions, the database file itself, the key files in `/data/npmpro` or other backups. Host configs and access list password files are not in it either: NPMpro writes them again after a restore.

## Creating a backup

1. Tick the parts you want (all are ticked at first).
2. Keep **Include secrets** on for a complete backup and enter a passphrase twice (at least 12 characters). Private keys, password hashes, two-factor secrets, DNS credential values, the OIDC client secret, the GeoIP license key and `crowdsec.conf` are then included, and the whole file is encrypted with the passphrase. NPMpro does not store the passphrase: write it down, without it the backup cannot be restored.
3. Click **Download** to save the file on your computer, or **Keep on server** to store it in `/data/backups`.

With **Include secrets** off the file is not encrypted and leaves the secrets out. It still contains host names, users and settings, so keep it private as well. After restoring it, enter the passwords, keys and credentials again.

## Stored backups

The list shows the backups in `/data/backups` with their contents. Use the menu of a row to download, restore or delete a backup, and **Upload backup** to add a file from your computer (up to 2 GiB).

Backups marked **Automatic** are made by NPMpro before every restore and are kept in `/data/backups/auto` (the newest 5). They are encrypted with this instance's key, need no passphrase and can only be restored on this instance.

`/data/backups/database` holds the copies of the SQLite database that NPMpro makes before it updates the database. They are not shown in the list; see [Troubleshooting](Troubleshooting#database-backup-and-restore).

## Restoring

1. Choose **Restore** in the menu of a stored backup and enter its passphrase if it has one.
2. The window shows what the backup holds. Untick the parts you want to keep as they are on this instance.
3. Check the lists below the selection:
   - references that will be cleared: for example a proxy host whose certificate is neither in the restore nor on this instance loses its certificate and is served without TLS until you choose another one
   - users that are skipped: your own account is never replaced
4. Tick the confirmation and click **Restore**.

What happens:

- The chosen parts on this instance are replaced by the ones in the backup, with the same ids. Parts you did not choose stay as they are.
- You stay signed in with your own account, password and two-factor setup. All other restored users are signed out and sign in again with their password and two-factor setup from the backup.
- NPMpro makes an automatic backup first. If the restore fails (for example because nginx rejects a restored custom nginx file), everything is rolled back and the error shows the nginx message.
- Hosts that nginx rejects on their own are taken offline and listed in the result; fix them on their host page.
- When restored settings only apply at start-up, the result asks you to restart the container.

A backup made by a newer NPMpro version cannot be restored: update NPMpro first.
