import { migrate as logger } from "../logger.js";

const migrateName = "traffic_totals";

// the host key of the all-hosts totals (lib/traffic/rollup.js ALL_HOSTS; a migration keeps its own copy)
const ALL_HOSTS = "*";
// buckets per transaction: 24 hours of an hour table or 24 minutes of the minute table
const BATCH = 24;
// [table, key columns, summed columns, kept name]: asn_name takes the largest name of the hour, as the all-hosts read
// did with max()
const TABLES = [
	["traffic_minute", ["status_class"], ["requests", "bytes"], null],
	["traffic_hour", ["status_class"], ["requests", "bytes"], null],
	["traffic_country_hour", ["country"], ["requests"], null],
	["traffic_asn_hour", ["asn"], ["requests"], "asn_name"],
	["traffic_ip_hour", ["ip"], ["requests"], null],
];

const backfill = async (knex, [table, keys, sums, name]) => {
	if (!(await knex.schema.hasTable(table))) return 0;
	const [range] = await knex(table).whereNot("host", ALL_HOSTS).min({ low: "bucket" }).max({ high: "bucket" });
	if (range?.low === null || range?.low === undefined) return 0;
	const named = name ? [name] : [];
	const columns = ["bucket", "host", ...keys, ...named, ...sums];
	const select = [
		"bucket",
		`'${ALL_HOSTS}'`,
		...keys.map(() => "??"),
		...named.map(() => "max(??)"),
		...sums.map(() => "sum(??)"),
	].join(", ");
	const sql =
		`insert into ?? (${columns.map(() => "??").join(", ")}) select ${select} from ?? ` +
		`where host <> '${ALL_HOSTS}' and bucket >= ? and bucket < ? group by bucket, ${keys.map(() => "??").join(", ")}`;
	let batches = 0;
	for (let from = Number(range.low); from <= Number(range.high); from += BATCH) {
		// delete, then insert, in one transaction per batch: a second run, or one after an interrupted run, writes the
		// same rows again
		await knex.transaction(async (trx) => {
			await trx(table)
				.where("host", ALL_HOSTS)
				.where("bucket", ">=", from)
				.where("bucket", "<", from + BATCH)
				.del();
			await trx.raw(sql, [table, ...columns, ...keys, ...named, ...sums, table, from, from + BATCH, ...keys]);
		});
		batches++;
	}
	return batches;
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
	for (const spec of TABLES) {
		const batches = await backfill(knex, spec);
		logger.info(`[${migrateName}] ${spec[0]}: all-hosts totals written in ${batches} batches`);
	}
	logger.info(`[${migrateName}] traffic totals written`);
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
