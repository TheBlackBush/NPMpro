import { after, before, describe } from "node:test";
import { startApi } from "./support/api.js";
import { hostQueryTests } from "./support/host-queries.js";
import { ENGINES, resetEngine } from "./support/servers.js";

const ctx = {};
const engine = ENGINES.postgres;

// biome-ignore lint/correctness/usePlaywrightValidDescribeCallback: node:test takes its options as the second argument
describe("host queries on Postgres", { skip: engine.skip, timeout: 180_000 }, () => {
	before(async () => {
		await resetEngine("postgres");
		ctx.api = await startApi({ env: engine.dbEnv() });
		ctx.admin = await ctx.api.admin();
	});
	after(() => ctx.api?.stop());

	hostQueryTests(ctx);
});
