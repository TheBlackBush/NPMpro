import { after, before } from "node:test";
import { startApi } from "./support/api.js";
import { hostQueryTests } from "./support/host-queries.js";

const ctx = {};

before(async () => {
	ctx.api = await startApi();
	ctx.admin = await ctx.api.admin();
});
after(() => ctx.api?.stop());

hostQueryTests(ctx);
