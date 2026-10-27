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

Backups marked **Automatic** are made by NPMpro before every restore, merge and page import and are kept in `/data/backups/auto` (the newest 5). They are encrypted with this instance's key, need no passphrase and can only be restored on this instance.

`/data/backups/database` holds the copies of the SQLite database that NPMpro makes before it updates the database. They are not shown in the list; see [Troubleshooting](Troubleshooting#database-backup-and-restore).

## Restoring

The restore window has two modes at the top: **Replace** swaps whole parts of this instance for the ones in the backup, **Merge** adds the backup's items without deleting anything (see [Merging](#merging)). A file exported from a list page holds only some items and can only be merged.

### Replace

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

## Merging

Choose **Merge** in the restore window to add the items of a backup to this instance. Nothing is deleted, and every merge shows a dry run before anything changes.

1. Untick the parts you do not want. **Choose items** below a part picks single items from it; the part then shows for example "3 of 12".
2. Check **Changes**: the counts of what is added, replaced, skipped or matched, then **Needs a choice** with every item that meets one on this instance. **Show all changes** lists every item.
3. Make the choices (the first one is the default):
   - a proxy, redirection or 404 host whose domain is already used by a host here, or a stream with the same port and protocol: **Skip** or **Replace** (the existing host is overwritten and keeps its id). A host that meets several hosts, or a host of another type, can only be skipped.
   - a certificate with the same domains: **Use the existing one** or **Add as new**
   - an access list or DNS credential with the same name: **Use the existing one** or **Add as new** (a DNS credential gets " (2)" after its name)
   - a user with the same email: **Use the existing one** or **Replace**. Your own account is never replaced.
   - a settings group or custom file that differs from this instance: **Keep this instance's** or **Take the backup's**
4. Check the linked items and the lists below them, then tick the confirmation and click **Restore**.

Linked items: the certificate, mTLS CA, access list and DNS credential that a chosen host or certificate uses come along and show which items need them. Untick one to leave it out: the host then uses the matching item on this instance, or loses the link if there is none. Every link that is cleared is listed before you confirm, and so are the imported items that need their passwords, keys or credentials filled in (a backup without secrets).

Imported items belong to the user with the same email on this instance, otherwise to you.

The merge applies exactly the dry run you confirmed. If something changed on the instance in the meantime (for example someone added a host with one of the backup's domains), the merge stops without changing anything and shows the new dry run to check again. As with Replace, NPMpro makes an automatic backup first and rolls everything back if nginx rejects the result.

## Import and export on the list pages

The Proxy hosts, Redirection hosts, 404 hosts, Streams, Certificates, Access lists and DNS credentials pages have **Export** and **Import** next to the Add button. They move single items between instances and are also open to users who are not administrators.

**Export** (needs view permission on the page):

1. Tick the items to export (all are ticked at first; **Select all** and **None** help with long lists).
2. Their linked certificates, access lists and DNS credentials are ticked under **Needed by the chosen items**; untick the ones you do not want. Linked items of a kind you cannot view are left out.
3. **Include secrets** with a passphrase entered twice adds private keys, access list passwords and DNS credential values, encrypted. It needs manage permission on the page and on the linked items you include.
4. Click **Download**. The file goes to your browser and is not stored on the server.

**Import** (needs manage permission on the page):

1. Click **Import** and choose a `.npmpro` file (up to 200 MB), then enter its passphrase if it has one.
2. The merge window opens for the page's kind and its linked items. There is no Replace, and users, settings and custom files are never imported from a page.
3. Make the choices as in [Merging](#merging) and click **Import**.

Imported items always belong to you. Linked items of a kind you cannot manage are not imported: they are matched with an existing item or their link is cleared (for example hosts imported without their certificate are served without TLS until you choose one). **Replace** is offered only for hosts you may edit, and a host you cannot see still blocks its domain, so the clashing item can only be skipped.
