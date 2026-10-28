import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const env = process.env;

// the Postgres tests run only where the test server is configured (not in CI)
const pgSkip = env.POSTGRES_NPMPRO_HOST ? false : "POSTGRES_NPMPRO_HOST is not set";

const pgConnection = {
	engine: "postgres",
	host: env.POSTGRES_NPMPRO_HOST ?? "",
	port: Number(env.POSTGRES_NPMPRO_PORT ?? 5432),
	user: env.POSTGRES_NPMPRO_USER ?? "",
	name: "npmpro_test_unit",
	password: env.POSTGRES_NPMPRO_PASS ?? "",
	ssl: { enabled: false },
};

// only ever npmpro_test_unit
const resetPg = async (knex) => {
	await knex.raw("drop schema public cascade");
	await knex.raw("create schema public");
};

const tempSqlite = async (name = "database.sqlite") => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "npmpro-db-"));
	const file = path.join(dir, name);
	return {
		dir,
		file,
		connection: { engine: "sqlite", file },
		cleanup: () => rm(dir, { recursive: true, force: true }),
	};
};

export { pgConnection, pgSkip, resetPg, tempSqlite };
