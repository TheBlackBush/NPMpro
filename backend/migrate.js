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
		await db().raw("PRAGMA auto_vacuum = 1");
		await db().raw("VACUUM");
		await db().raw("PRAGMA optimize");
		logger.info("Sqlite database vacuumed");
	}

	return result;
};

export { migrateUp };
