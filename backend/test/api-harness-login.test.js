import assert from "node:assert/strict";
import { after, before, it, mock } from "node:test";
import { startApi } from "./support/api.js";

// The column default of npmpro_token_valid_after is the second of the migration, and a token issued in that second or
// before is refused. With the clock held still, every login of the harness happens in that second, so this is the
// slowest machine the harness must survive: a fast one reaches the same state by chance.

const ctx = {};
before(async () => {
	mock.timers.enable({ apis: ["Date"], now: Date.now() });
	ctx.api = await startApi();
});
after(() => {
	mock.timers.reset();
	return ctx.api?.stop();
});

it("gives the administrator a working session in the second of the migration", async () => {
	const admin = await ctx.api.admin();
	const me = await admin.get("/users/me");
	assert.equal(me.status, 200, me.text);
});

it("gives a limited user a working session in the second of the migration", async () => {
	const user = await ctx.api.limited({ visibility: "user", streams: "manage", certificates: "view" });
	const me = await user.get("/users/me");
	assert.equal(me.status, 200, me.text);
});
