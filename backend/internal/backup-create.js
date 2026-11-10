import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { packStage } from "../lib/backup/archive.js";
import { exportStage } from "../lib/backup/export.js";
import { writeBackupFile } from "../lib/backup/format.js";
import { TYPES } from "../lib/backup/types.js";
import { ALL_TYPES, exists, withoutStage } from "./backup-shared.js";

// the regular files below dir that allow takes, as paths relative to base
const countFiles = async (dir, base, allow) => {
	const info = await exists(dir);
	if (!info) return 0;
	const rel = path.relative(base, dir).split(path.sep).join("/");
	if (!allow(rel)) return 0;
	if (info.isFile()) return 1;
	if (!info.isDirectory()) return 0;
	let count = 0;
	for (const name of await readdir(dir)) count += await countFiles(path.join(dir, name), base, allow);
	return count;
};

// writing backup files: the counts of a type, one export into a file, the automatic backup
const createBackupWriter = ({
	knex,
	box,
	dataDir,
	store,
	dbVersion,
	dbMigrations,
	npmproVersion,
	instanceKey,
	hostname,
	clock,
}) => {
	const createdBy = async (userId) => {
		const user = await knex("user").where({ id: userId }).first("name", "email");
		return { name: user?.name ?? "", email: user?.email ?? "" };
	};

	const countRows = async (typeId) => {
		const { table, where } = TYPES[typeId].tables[0];
		const query = knex(table);
		if (where) where(query);
		const [{ count }] = await query.count({ count: "*" });
		return Number(count);
	};

	const countTypeFiles = async (typeId) => {
		const { files } = TYPES[typeId];
		let count = 0;
		for (const root of files.roots) count += await countFiles(path.join(dataDir, root), dataDir, files.allow);
		return count;
	};

	/**
	 * Exports the types into a backup file at file; the caller holds the lock
	 *
	 * @returns {Promise<Object>}  the header summary
	 */
	const writeBackup = async ({ file, types, secrets, mode, passphrase, userId, items, accounts }) => {
		const stageDir = await store.createStageDir("tmp");
		try {
			const { summary } = await exportStage({
				knex,
				box,
				dataDir,
				stageDir,
				types,
				secrets,
				items,
				accounts,
				meta: {
					npmproVersion,
					dbVersion: await dbVersion(),
					dbMigrations: await dbMigrations(),
					createdBy: await createdBy(userId),
					createdAt: new Date(clock.now()).toISOString(),
				},
			});
			await writeBackupFile({
				source: packStage(stageDir),
				file,
				mode,
				passphrase,
				instanceKey: mode === "instance" ? await instanceKey() : undefined,
				summary,
			});
			return summary;
		} finally {
			await withoutStage(stageDir);
		}
	};

	const entryOf = async (name) => (await store.list()).find((item) => item.name === name);

	// every type, secrets included, into backups/auto with the instance key; page: before a page import, named and
	// pruned apart from the Settings ones; the caller holds the lock
	const automaticBackup = async (userId, page = false) => {
		const name = store.uniqueName(
			store.fileName({ host: hostname, date: new Date(clock.now()), auto: true, page }),
		);
		const file = store.pathOf(name);
		await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
		await writeBackup({ file, types: ALL_TYPES, secrets: true, mode: "instance", userId });
		await store.pruneAuto();
		return name;
	};

	return { createdBy, countRows, countTypeFiles, writeBackup, entryOf, automaticBackup };
};

export { createBackupWriter };
