import { migrate as logger } from "../logger.js";

const migrateName = "traffic_paths";

/**
 * Migrate
 *
 * @see https://knexjs.org/guide/migrations.html#migration-api
 *
 * @param   {Object}  knex
 * @returns {Promise}
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	// MySQL DDL is not transactional, so a rerun must be safe
	if (await knex.schema.hasTable("traffic_path_hour")) {
		return;
	}
	const mysql = ["mysql", "mysql2"].includes(knex.client.config.client);
	await knex.schema.createTable("traffic_path_hour", (table) => {
		if (mysql) {
			// 4 byte characters and a binary collation: paths that differ only in case or accents are separate rows (a
			// case-insensitive collation would make the unique index refuse them and fail every flush)
			table.charset("utf8mb4");
			table.collate("utf8mb4_bin");
		}
		table.increments().primary();
		// an hour bucket; rows of days before yesterday are folded into one row per day at bucket = day * 24
		table.integer("bucket").notNull();
		table.string("host", 255).notNull();
		table.string("path", 200).notNull();
		table.bigInteger("requests").notNull().defaultTo(0);
		// unix seconds of the newest request (a 32-bit integer would end in 2038)
		table.bigInteger("last_seen").notNull().defaultTo(0);
		// also the conflict target of the set-based upsert
		table.unique(["bucket", "host", "path"], { indexName: "tph_uq" });
		// the per host views need host first; the unique index already starts with bucket
		table.index(["host", "bucket"], "tph_hb");
	});

	logger.info(`[${migrateName}] traffic_path_hour table created`);
};

/**
 * Undo Migrate
 *
 * @param   {Object}  _knex
 * @returns {Promise}
 */
const down = (_knex) => {
	throw new Error(`[${migrateName}] You can't migrate down this one.`);
};

export { down, up };
