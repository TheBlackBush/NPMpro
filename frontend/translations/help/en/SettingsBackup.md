## Backup and restore

Save your hosts, certificates, users and settings to a `.npmpro` file, and restore it on this or another NPMpro instance. Traffic statistics and logs are never part of a backup.

### Create backup

- **What to include**: parts such as hosts, access lists, certificates, DNS credentials, users, settings and custom files. All are ticked at first.
- **Include secrets**: adds private keys, passwords, two-factor secrets, DNS credential values, the OIDC client secret and the GeoIP license key. The file is encrypted with a **Passphrase** of at least 12 characters, which you enter twice. NPMpro does not store it, so without it the backup cannot be restored.
- Without secrets the file is not encrypted and leaves the secrets out. It still holds host names, users and settings, so keep it private.
- **Download** saves the file to your computer. **Keep on server** stores it in `/data/backups`.

### Scheduled backups

Add schedules that make backups on their own and store them on the server.

- **When**: every N hours, daily, weekly or monthly, in the container's time zone.
- **Protection**: **Passphrase** (restores anywhere), **Instance key** (nothing to remember, restores only on this instance) or **Without secrets**.
- **Keep**: how many files of this schedule to keep. Older ones are deleted after each successful run.
- A schedule can be run now, paused, edited or deleted. A failed run is shown on the schedule and on the dashboard.

Scheduled backups protect you from bad changes, not from losing the disk. Copy the files to another machine for that.

### Stored backups

Lists the files on the server. Download, restore or delete them, or **Upload backup**. NPMpro makes an **Automatic** backup before every restore, merge and database move; it needs no passphrase and restores only on this instance.

### Restore

- **Replace** swaps the parts you choose on this instance for those in the backup. Your own account is never replaced.
- **Merge** adds the backup's items and deletes nothing. It shows a preview and lets you choose for each clash: skip, use the existing item, add as new, or replace.

A restore is rolled back if nginx rejects the result. A backup from a newer NPMpro version cannot be restored. Some restored settings need a container restart.

This section has no environment variables.

More in the wiki: Backup-and-restore.
