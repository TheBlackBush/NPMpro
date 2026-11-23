import { after, before, describe } from "node:test";
import { startApi } from "./support/api.js";
import { ddnsStoreTests } from "./support/ddns-store.js";
import { ENGINES, resetEngine } from "./support/servers.js";

const ctx = {};
const engine = ENGINES.mysql;

describe("DDNS store on MySQL", { skip: engine.skip, timeout: 180_000 }, () => {
	before(async () => {
		await resetEngine("mysql");
		ctx.api = await startApi({ env: engine.dbEnv() });
		ctx.admin = await ctx.api.admin();
	});
	after(() => ctx.api?.stop());

	ddnsStoreTests(ctx);
});
