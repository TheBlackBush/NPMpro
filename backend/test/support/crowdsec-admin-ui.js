import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { up } from "../../migrations/20261115120000_crowdsec_admin_ui.js";

// 20261115120000_crowdsec_admin_ui on each database engine: the admin_ui_excluded switch of the crowdsec setting row
// becomes admin_ui, and no other row is touched.
// ctx.knex: a database with a setting table (id string primary, name, description, value, meta json not null).

const metaOf = async (knex, id) => {
	const row = await knex("setting").where("id", id).first("meta");
	return typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
};

const crowdsecAdminUiTests = (ctx) => {
	const put = (id, meta) =>
		ctx.knex("setting").insert({ id, name: id, description: "", value: "", meta: JSON.stringify(meta) });

	beforeEach(() => ctx.knex("setting").del());

	it("turns the switch on into bans and keeps the other values", async () => {
		await put("crowdsec", { enabled: true, api_key: "sealed", admin_ui_excluded: true });
		await up(ctx.knex);
		assert.deepEqual(await metaOf(ctx.knex, "crowdsec"), { enabled: true, api_key: "sealed", admin_ui: "bans" });
	});

	it("turns the switch off into checked", async () => {
		await put("crowdsec", { enabled: true, admin_ui_excluded: false });
		await up(ctx.knex);
		assert.deepEqual(await metaOf(ctx.knex, "crowdsec"), { enabled: true, admin_ui: "checked" });
	});

	it("keeps an admin_ui that is already set and drops the switch", async () => {
		await put("crowdsec", { admin_ui: "out", admin_ui_excluded: true });
		await up(ctx.knex);
		assert.deepEqual(await metaOf(ctx.knex, "crowdsec"), { admin_ui: "out" });
	});

	it("leaves a row without the switch and a missing row as they are", async () => {
		await put("crowdsec", { enabled: true, admin_ui: "bans" });
		await up(ctx.knex);
		assert.deepEqual(await metaOf(ctx.knex, "crowdsec"), { enabled: true, admin_ui: "bans" });
		await ctx.knex("setting").del();
		await up(ctx.knex);
		assert.equal((await ctx.knex("setting")).length, 0);
	});

	it("gives the same row when it runs twice", async () => {
		await put("crowdsec", { enabled: false, admin_ui_excluded: true });
		await up(ctx.knex);
		const once = await metaOf(ctx.knex, "crowdsec");
		await up(ctx.knex);
		assert.deepEqual(await metaOf(ctx.knex, "crowdsec"), once);
	});

	it("does not touch another setting row", async () => {
		await put("default-site", { admin_ui_excluded: true });
		await put("crowdsec", { admin_ui_excluded: true });
		await up(ctx.knex);
		assert.deepEqual(await metaOf(ctx.knex, "default-site"), { admin_ui_excluded: true });
		assert.deepEqual(await metaOf(ctx.knex, "crowdsec"), { admin_ui: "bans" });
	});
};

export { crowdsecAdminUiTests };
