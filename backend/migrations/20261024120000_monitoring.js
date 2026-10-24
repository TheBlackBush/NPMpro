import { migrate as logger } from "../logger.js";

const migrateName = "monitoring";

/**
 * Creates a traffic table unless it exists (MySQL DDL is not transactional, so a rerun must be safe).
 * Index names are explicit and short (MySQL limits them to 64 characters).
 *
 * @param   {Object}    knex
 * @param   {Object}    table
 * @param   {String}    table.name
 * @param   {String}    table.short     prefix for the index names
 * @param   {Function}  table.columns   adds the table specific columns
 * @param   {String[]}  table.unique    columns of the unique index
 * @returns {Promise}
 */
const createTraffic = async (knex, { name, short, columns, unique }) => {
	if (await knex.schema.hasTable(name)) {
		return;
	}
	await knex.schema.createTable(name, (table) => {
		table.increments().primary();
		table.integer("bucket").notNull();
		table.string("host", 255).notNull();
		columns(table);
		table.unique(unique, { indexName: `${short}_uq` });
		table.index(["bucket"], `${short}_bucket`);
	});
};

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

	const counts = (table) => {
		table.bigInteger("requests").notNull().defaultTo(0);
	};

	for (const [name, short] of [
		["traffic_minute", "tm"],
		["traffic_hour", "th"],
	]) {
		await createTraffic(knex, {
			name,
			short,
			columns: (table) => {
				table.string("status_class", 8).notNull();
				counts(table);
				table.bigInteger("bytes").notNull().defaultTo(0);
			},
			unique: ["bucket", "host", "status_class"],
		});
	}
	await createTraffic(knex, {
		name: "traffic_country_hour",
		short: "tch",
		columns: (table) => {
			table.string("country", 2).notNull();
			counts(table);
		},
		unique: ["bucket", "host", "country"],
	});
	await createTraffic(knex, {
		name: "traffic_asn_hour",
		short: "tah",
		columns: (table) => {
			table.bigInteger("asn").notNull();
			table.string("asn_name", 255).notNull().defaultTo("");
			counts(table);
		},
		unique: ["bucket", "host", "asn"],
	});
	await createTraffic(knex, {
		name: "traffic_ip_hour",
		short: "tih",
		columns: (table) => {
			table.string("ip", 45).notNull();
			counts(table);
		},
		unique: ["bucket", "host", "ip"],
	});

	logger.info(`[${migrateName}] traffic tables created`);
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
