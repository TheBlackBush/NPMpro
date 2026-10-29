# Database

NPMpro keeps its hosts, certificates, users, settings, the audit log and the traffic statistics in a database. Without any setup this is SQLite, a single file in the data folder (`/data/npmpro/database.sqlite`), and that is the recommended choice. NPMpro can also run on MySQL, MariaDB or PostgreSQL, and it can move itself between these databases from the web UI.

You find this under Settings, Database; only administrators see it.

## What the section shows

- **Database in use:** the engine and its version, where it is (the file, or host, port and database name), its size, and the **Source** of the connection:
  - **Default:** the SQLite file `/data/npmpro/database.sqlite`
  - **Database settings file:** `/data/npmpro/database.json`, written by a move
  - **Environment:** the `DB_MYSQL_*` or `DB_POSTGRES_*` variables
- After a move it also says when and from which engine NPMpro was moved.
- **Tables:** every table with its number of rows. The card can be collapsed and remembers its state.

## Requirements for a move

- A target database server: MySQL 8.0 or newer, MariaDB 10.6 or newer, or PostgreSQL 13 or newer. Older servers are refused.
- An **empty** database on it, and a user that may create and drop tables in it. Create both in your database server first; NPMpro does not create the database itself.
- The NPMpro container must reach the server. With `network_mode: host` that is the server's address as seen from the host.
- For SQLite as the target nothing is needed: a move to SQLite always creates a new file `/data/npmpro/database-<date>.sqlite`.

## Moving to another database

1. Under **Move to another database**, choose the **Engine** and enter **Host**, **Port**, **Database name**, **User** and **Password**. Turn on **Use TLS** if the server needs it (for MySQL and MariaDB you can also choose **Check the server certificate** and **Check the server name**).
2. Click **Test connection**. NPMpro connects (with a 10 second limit) and checks the version, that the database is empty, that the user can create tables, and that it is not the database in use. The test changes nothing on the target. With SQLite there is nothing to test.
3. Click **Move**. The window shows how many tables and rows are copied. Type the engine name it asks for and click **Move now**.

The window then shows each step:

1. **Pause changes:** NPMpro refuses changes until the move is over. A banner on every page, also on the login page, says that a database move is in progress. Signing in keeps working, and your sites keep being served.
2. **Safety backup:** an automatic backup of everything into `/data/backups/auto` (see [Backup and restore](Backup-and-restore#stored-backups)).
3. **Create the tables:** the target gets NPMpro's tables.
4. **Copy the rows:** every row of every table is copied, with progress per table: hosts, certificates, users, settings, the audit log, traffic statistics and sessions.
5. **Check the copy:** the row counts and samples of the rows are compared.
6. **Switch and restart:** NPMpro writes the new connection to `/data/npmpro/database.json` and restarts on the new database. nginx keeps serving your sites during the restart.

The page reloads when NPMpro answers again. Unless `COOKIE_SECRET` is set, everyone has to sign in again (see [Troubleshooting](Troubleshooting#signed-out-after-every-restart)). If NPMpro does not answer within 2 minutes, the window says so: reload the page to check, and read `docker logs npmpro`.

While the move runs, a change made in another tab or by another user is refused with "A database move is in progress. Try again when it is done."

## When a move fails

If any step before the switch fails, NPMpro stays on the database it was using, changes are allowed again, the window names the step that stopped, and the audit log gets a "move failed" entry. Common causes are a wrong password, a server that cannot be reached, a target that is not empty, or a server that is too old.

The target keeps what the move had already created there (tables and rows). Since a move only starts on an empty database, empty or recreate the target database before you try again. A leftover SQLite file from a failed move does not block the next one (each move creates a new file); delete it to free the space.

## The connection file and the way back

The database in use before the move is never changed or deleted. It is your way back:

- Delete or rename `/data/npmpro/database.json` and restart the container. NPMpro then starts on the default SQLite file `/data/npmpro/database.sqlite` again.
- That file holds the data as it was when the move started. Changes made afterwards, on the new database, are not in it. To take them along, move back to SQLite from Settings, Database instead (this creates a new SQLite file with the current data), or make a backup on the new database and restore it after going back.

`database.json` holds the connection, with the password encrypted by the instance key in `/data/npmpro/dns-credentials.key`. The two files belong together: keep and copy them together, because without the key NPMpro cannot read the password and does not start.

If `database.json` cannot be used (damaged, edited by hand, or the key is missing), NPMpro does not fall back to SQLite. It does not start and logs which file to remove, see [Troubleshooting](Troubleshooting#the-database-settings-file-cannot-be-used).

## Environment variables

When `DB_MYSQL_*` or `DB_POSTGRES_*` variables are set in `compose.yaml`, they always win over `database.json`, and the section is read-only ("The connection comes from the environment"). To move such an instance:

1. Make a backup with secrets under Settings, Backup and restore and download it.
2. Change the variables to the new database (or remove them to use SQLite) and recreate the container.
3. Sign in on the new database (an empty database starts with the setup page) and restore the backup under Settings, Backup and restore.

## MySQL and MariaDB time zone

MySQL and MariaDB connections use the container's time zone (`TZ`) for their session, so the times the database writes match the times NPMpro writes. This applies to every MySQL or MariaDB connection, also one set with `DB_MYSQL_*`. Rows written by an older version while the database server used another zone than `TZ` keep their shifted times.

When the server has no time zone tables, NPMpro uses the current UTC offset of `TZ` instead and logs this once. Then restart the container after each daylight saving time change.

## Password reset

`password-reset.js` (see [Troubleshooting](Troubleshooting#password-or-mfa-reset)) only works on the default SQLite file `/data/npmpro/database.sqlite`. After a move it would change that old file, not the database in use, so it does not help there.
