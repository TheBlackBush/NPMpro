import { migrate as logger } from "../logger.js";

const migrateName = "clean_audit_log_meta";

// Frozen copy of the strip logic at the time of this migration, independent of lib/helpers.js.
const localDateTimePattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/u;
const strippedKeys = [
	"certificate",
	"certificate_key",
	"dns_provider_credentials",
	"npmplus_dns_provider_credentials",
	"hint",
];

const jsonReplacer = (key, value) => {
	if (typeof value !== "string") return value;
	if (key === "password") return "";
	if (strippedKeys.includes(key)) {
		return;
	}
	if (["created_on", "modified_on", "expires_on"].includes(key) && localDateTimePattern.test(value)) {
		return new Date(value.replace(" ", "T")).toISOString();
	}
	return value;
};

/**
 * Migrate
 *
 * @see https://knexjs.org/guide/migrations.html#migration-api
 *
 * @param   {Object} knex
 * @returns {Promise}
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	let rows = [];
	do {
		rows = await knex("audit_log")
			.select("id", "meta")
			.where("id", ">", rows.at(-1)?.id ?? 0)
			.orderBy("id")
			.limit(100);

		for (const row of rows) {
			const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
			const cleanedMeta = JSON.stringify(meta, jsonReplacer);
			if (cleanedMeta !== JSON.stringify(meta)) {
				await knex("audit_log").where("id", row.id).update({ meta: cleanedMeta });
			}
		}
	} while (rows.length > 0);

	logger.info(`[${migrateName}] audit_log Table altered`);
};

/**
 * Undo Migrate
 *
 * @param   {Object} _knex
 * @returns {Promise}
 */
const down = (_knex) => {
	throw new Error(`[${migrateName}] You can't migrate down this one.`);
};

export { down, up };
