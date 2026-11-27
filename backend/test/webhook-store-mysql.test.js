import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe } from "node:test";
import knexFactory from "knex";
import { ENGINES, resetEngine } from "./support/servers.js";
import { webhookStoreTests } from "./support/webhook-store.js";

const ctx = {};
const engine = ENGINES.mysql;

// the app modules read the paths and the database settings once, at their first import: a test root and this server
const root = await mkdtemp(path.join(os.tmpdir(), "npmpro-webhook-store-"));
await mkdir(path.join(root, "data/npmpro"), { recursive: true });
if (!engine.skip) Object.assign(process.env, engine.dbEnv(), { NPMPRO_TEST_ROOT: root });

describe("Webhook store on MySQL", { skip: engine.skip, timeout: 120_000 }, () => {
	before(async () => {
		await resetEngine("mysql");
		ctx.knex = knexFactory({ client: engine.client, connection: engine.connection() });
		const { runMigrations } = await import("../lib/database/schema.js");
		await runMigrations(ctx.knex);
		({ createWebhookStore: ctx.createWebhookStore } = await import("../lib/notify/webhook-channel.js"));
	});
	after(async () => {
		await ctx.knex?.destroy();
		const { default: db } = await import("../db.js");
		await db().destroy();
	});

	webhookStoreTests(ctx);
});

after(() => rm(root, { recursive: true, force: true }));
