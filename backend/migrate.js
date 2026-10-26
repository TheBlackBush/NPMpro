import { mkdir, readdir, rm } from "node:fs/promises";
import db from "./db.js";
import { isSqlite } from "./lib/config.js";
import { migrate as logger } from "./logger.js";

const migrationConfig = { tableName: "migrations", directory: "migrations" };
const backupDir = "/data/npmpro/backups";
const keepBackups = 5;
const backupPattern = /^database-.+\.sqlite$/u;

/**
 * Copies the sqlite database before pending migrations change it, so an upgrade can be undone by
 * restoring the copy and starting the previous image. Keeps the newest few backups.
 *
 * @param   {String}  version  current database version
 * @param   {Number}  pending  number of pending migrations
 * @returns {Promise}
 */
const backupSqlite = async (version, pending) => {
	await mkdir(backupDir, { recursive: true, mode: 0o700 });
	const stamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
	const file = `${backupDir}/database-${stamp}-v${version}.sqlite`;
	// VACUUM INTO writes a consistent copy, also while the database is in WAL mode
	await db().raw("VACUUM INTO ?", [file]);
	logger.info(`Database backed up to ${file} before ${pending} migration(s)`);

	const backups = (await readdir(backupDir)).filter((name) => backupPattern.test(name)).sort();
	for (const name of backups.slice(0, -keepBackups)) {
		await rm(`${backupDir}/${name}`, { force: true });
	}
};

const migrateUp = async () => {
	const version = await db().migrate.currentVersion(migrationConfig);
	logger.info("Current database version:", version);

	// a fresh database has nothing worth backing up
	if (isSqlite() && version !== "none") {
		const [, pending] = await db().migrate.list(migrationConfig);
		if (pending.length > 0) {
			await backupSqlite(version, pending.length);
		}
	}

	const result = await db().migrate.latest(migrationConfig);

	if (isSqlite()) {
		await db().raw("PRAGMA journal_mode = WAL");
		// full auto_vacuum gives freed pages back on every commit, so the database is only rewritten (VACUUM, which
		// needs the time and the free space of a whole copy) once, to switch an older database to it
		const pragma = await db().raw("PRAGMA auto_vacuum");
		const autoVacuum = (Array.isArray(pragma) ? pragma[0] : pragma)?.auto_vacuum;
		if (Number(autoVacuum) !== 1) {
			await db().raw("PRAGMA auto_vacuum = 1");
			await db().raw("VACUUM");
			logger.info("Sqlite database switched to auto_vacuum and vacuumed once");
		}
		// the write-ahead log can still hold old pages (old secrets)
		await db().raw("PRAGMA wal_checkpoint(TRUNCATE)");
		await db().raw("PRAGMA optimize");
	}

	return result;
};

export { migrateUp };
