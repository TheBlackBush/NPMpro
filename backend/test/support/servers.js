import knexFactory from "knex";

// The real database servers of the CI job. A test file gets a server of its own by name and runs alone (see the
// "tests on real database servers" step of test.yml), as all of them use the one database npmpro_test_unit.
const env = process.env;
const NAME = "npmpro_test_unit";

const ENGINES = {
	postgres: {
		skip: env.POSTGRES_NPMPRO_HOST ? false : "POSTGRES_NPMPRO_HOST is not set",
		client: "pg",
		connection: () => ({
			host: env.POSTGRES_NPMPRO_HOST,
			port: Number(env.POSTGRES_NPMPRO_PORT ?? 5432),
			user: env.POSTGRES_NPMPRO_USER,
			password: env.POSTGRES_NPMPRO_PASS,
			database: NAME,
		}),
		dbEnv: () => ({
			DB_POSTGRES_HOST: env.POSTGRES_NPMPRO_HOST,
			DB_POSTGRES_PORT: env.POSTGRES_NPMPRO_PORT ?? "5432",
			DB_POSTGRES_USER: env.POSTGRES_NPMPRO_USER,
			DB_POSTGRES_PASSWORD: env.POSTGRES_NPMPRO_PASS,
			DB_POSTGRES_NAME: NAME,
		}),
		reset: async (knex) => {
			await knex.raw("drop schema public cascade");
			await knex.raw("create schema public");
		},
	},
	mysql: {
		skip: env.MYSQL_NPMPRO_HOST ? false : "MYSQL_NPMPRO_HOST is not set",
		client: "mysql2",
		connection: () => ({
			host: env.MYSQL_NPMPRO_HOST,
			port: Number(env.MYSQL_NPMPRO_PORT ?? 3306),
			user: env.MYSQL_NPMPRO_USER,
			password: env.MYSQL_NPMPRO_PASS,
			database: NAME,
		}),
		dbEnv: () => ({
			DB_MYSQL_HOST: env.MYSQL_NPMPRO_HOST,
			DB_MYSQL_PORT: env.MYSQL_NPMPRO_PORT ?? "3306",
			DB_MYSQL_USER: env.MYSQL_NPMPRO_USER,
			DB_MYSQL_PASSWORD: env.MYSQL_NPMPRO_PASS,
			DB_MYSQL_NAME: NAME,
		}),
		reset: async (knex) => {
			const [rows] = await knex.raw(
				"select table_name as name from information_schema.tables where table_schema = database()",
			);
			await knex.raw("set foreign_key_checks = 0");
			for (const { name } of rows) await knex.schema.dropTable(name);
			await knex.raw("set foreign_key_checks = 1");
		},
	},
};

/**
 * Empties the test database of an engine. One connection, as foreign_key_checks belongs to the session.
 *
 * @param {"postgres"|"mysql"} name
 */
const resetEngine = async (name) => {
	const engine = ENGINES[name];
	const knex = knexFactory({ client: engine.client, connection: engine.connection(), pool: { min: 1, max: 1 } });
	try {
		await engine.reset(knex);
	} finally {
		await knex.destroy();
	}
};

export { ENGINES, resetEngine };
