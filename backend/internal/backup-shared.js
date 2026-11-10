import { lstat, rm } from "node:fs/promises";
import { BackupError } from "../lib/backup/format.js";
import { CATEGORIES, RESTORE_ORDER, TYPES } from "../lib/backup/types.js";

// Helpers that two or more of the backup files use. None of them reads the service's injected dependencies.

const ALL_TYPES = CATEGORIES.flatMap((category) => category.types);

const invalid = (reason) => new BackupError("invalid-archive", reason);

const isTypeList = (types) =>
	Array.isArray(types) && types.length > 0 && types.every((typeId) => Object.hasOwn(TYPES, typeId));

// the chosen types once each, in restore order; an unknown or empty choice is refused
const chosenTypes = (types, available = ALL_TYPES) => {
	if (!isTypeList(types)) throw new BackupError("invalid-types", "Choose at least one known type");
	const missing = types.filter((typeId) => !available.includes(typeId));
	if (missing.length > 0) throw new BackupError("invalid-types", `The backup does not hold ${missing.join(", ")}`);
	return RESTORE_ORDER.filter((typeId) => types.includes(typeId));
};

/**
 * The migrations a backup's database had that this instance has not run. Compared as a set: some old names have
 * malformed timestamps, so the newest name says nothing. A backup without the list is accepted.
 */
const unknownMigrations = (backupMigrations, instanceMigrations) => {
	if (backupMigrations === undefined) return [];
	if (!(Array.isArray(backupMigrations) && backupMigrations.every((name) => typeof name === "string"))) {
		throw invalid("The manifest lists invalid migrations");
	}
	const known = new Set(instanceMigrations);
	return backupMigrations.filter((name) => !known.has(name));
};

const exists = (file) =>
	lstat(file).then(
		(info) => info,
		(error) => {
			if (error.code === "ENOENT") return null;
			throw error;
		},
	);

const withoutStage = async (stageDir) => {
	if (stageDir) await rm(stageDir, { recursive: true, force: true });
};

export { ALL_TYPES, chosenTypes, exists, invalid, isTypeList, unknownMigrations, withoutStage };
