import { after, before, describe } from "node:test";
import { startApi } from "./support/api.js";
import { ddnsStoreTests } from "./support/ddns-store.js";
import { ENGINES, resetEngine } from "./support/servers.js";

const ctx = {};
const engine = ENGINES.postgres;

describe("DDNS store on Postgres", { skip: engine.skip, timeout: 180_000 }, () => {
	before(async () => {
		await resetEngine("postgres");
		ctx.api = await startApi({ env: engine.dbEnv() });
		ctx.admin = await ctx.api.admin();
	});
	after(() => ctx.api?.stop());

	ddnsStoreTests(ctx);
});
