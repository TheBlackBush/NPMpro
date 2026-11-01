## Database

The database NPMpro keeps its hosts, certificates, users, logs and statistics in. By default this is SQLite, a single file, and that is the recommended choice. You can move everything to MySQL, MariaDB, PostgreSQL or a new SQLite file from here. The database in use is not changed by a move.

### Database in use

Shows the engine and version, where it is, its size and the **Source** of the connection: **Default** (the SQLite file `/data/npmpro/database.sqlite`), **Database settings file** (`/data/npmpro/database.json`, written by a move) or **Environment** (`DB_MYSQL_*` or `DB_POSTGRES_*` variables). After a move it says when and from which engine you moved.

### Tables

Every table with its rows and size. The card can be collapsed.

### Move to another database

Create an empty database and a user that can create tables on your server first; NPMpro does not create the database. Requirements: MySQL 8.0, MariaDB 10.6 or PostgreSQL 13 or newer.

1. Choose the **Engine** and enter **Host**, **Port**, **Database name**, **User** and **Password**. Turn on **Use TLS** if the server needs it (for MySQL and MariaDB you can also **Check the server certificate** and **Check the server name**). A move to SQLite needs nothing: it creates a new file in `/data/npmpro`.
2. **Test connection**. It checks the version, that the database is empty and that the user can create tables. It changes nothing.
3. **Move**, then type the word it asks for and click **Move now**.

NPMpro pauses changes, makes a safety backup, creates the tables, copies and checks every row, then restarts on the new database. Your sites keep being served. The page reloads when NPMpro answers again, and you may need to sign in again.

If a step fails, NPMpro stays on the database it used and the window names the step that stopped. The old database is never deleted, so you can go back: remove `/data/npmpro/database.json` and restart the container.

If the connection comes from `DB_MYSQL_*` or `DB_POSTGRES_*` variables, the section is read-only. To move, make a backup, point the variables at the new database, restart and restore the backup.

More in the wiki: Database.
