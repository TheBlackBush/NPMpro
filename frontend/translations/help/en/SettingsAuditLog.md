## Audit Logs

A record of who changed what. Only administrators see it.

Each entry shows the user, the object and the action. These are logged:

- **Created**, **Updated** and **Deleted** for proxy hosts, redirection hosts, 404 hosts, streams, access lists, certificates, DNS credentials, backup schedules and users. Settings only log **Updated**.
- **Enabled** and **Disabled** for proxy hosts, redirection hosts, 404 hosts, streams and backup schedules.
- Backups: **Created**, **Uploaded**, **Deleted**, **Restored** and **Merged** for a backup, and **Backup succeeded** and **Backup failed** for scheduled backup runs.
- **Downloaded** for certificates. **Exported** and **Imported** for the backup of a single page (hosts, access lists, certificates, DNS credentials).
- Database moves: **Moved** and **Move failed**.

The newest entries come first. **Load more** shows the next 50, and the count below the list tells how many of the total are loaded.

### Find an entry

- **Search** looks in the details of every entry, so a domain name or an email address finds its entries.
- **Object type**, **Action** and **User** narrow the list. They combine with each other and with the search.
- With a filter or search active, the list says how many entries are shown. **Clear filters** removes them all.

### Details

The eye button of a row (**View Details**) opens the entry: the user, what happened and the data stored with it. For a change this is the object as it was saved. Long values wrap, and the window scrolls.

A user that has since been deleted shows as **Deleted User**. NPMpro never removes entries on its own, and the audit log is not part of a backup.

More in the wiki: Usage (Audit Logs).
