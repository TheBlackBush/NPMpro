import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startApi } from "./support/api.js";

let api;
let buildAclFile;

// the internal module reads its paths from the test root that startApi sets up
before(async () => {
	api = await startApi();
	({
		default: { buildAclFile },
	} = await import("../internal/proxy-host-access-list.js"));
});
after(() => api?.stop());

const rule = (directive, address) => ({ directive, address });
const list = (id, clients, extra = {}) => ({ id, clients, items: [], ...extra });
const build = (...lists) => buildAclFile(lists);
const last = (built) => built.clients.at(-1);

describe("buildAclFile catch-all (#3808)", () => {
	it("denies when one list ends with deny all", () => {
		const built = build(
			list(1, [rule("allow", "10.0.0.5"), rule("allow", "all")]),
			list(2, [rule("allow", "10.0.0.6"), rule("deny", "all")]),
		);
		assert.deepEqual(last(built), rule("deny", "all"));
	});

	it("allows when every list with IP rules ends with allow all", () => {
		const built = build(
			list(1, [rule("allow", "10.0.0.5"), rule("allow", "all")]),
			list(2, [rule("allow", "10.0.0.6"), rule("allow", "all")]),
		);
		assert.deepEqual(last(built), rule("allow", "all"));
	});

	it("does not count a list that has only an all rule", () => {
		const built = build(list(1, [rule("allow", "all")]), list(2, [rule("allow", "10.0.0.6"), rule("deny", "all")]));
		assert.deepEqual(last(built), rule("deny", "all"));
	});

	it("votes deny for a list without client rules (D9 literal, as develop)", () => {
		const built = build(list(1, []), list(2, [rule("deny", "1.2.3.4"), rule("allow", "all")]));
		assert.deepEqual(last(built), rule("deny", "all"));
	});

	it("keeps a mixed all list in the vote, in either order", () => {
		const mixed = [rule("allow", "all"), rule("deny", "all")];
		const open = [rule("allow", "10.0.0.1"), rule("allow", "all")];
		assert.deepEqual(last(build(list(1, mixed), list(2, open))), rule("deny", "all"));
		assert.deepEqual(last(build(list(1, open), list(2, mixed))), rule("deny", "all"));
	});

	it("counts a list that has only deny all", () => {
		const built = build(
			list(1, [rule("deny", "all")]),
			list(2, [rule("allow", "10.0.0.0/8"), rule("allow", "all")]),
		);
		assert.deepEqual(built.clients, [rule("allow", "10.0.0.0/8"), rule("deny", "all")]);
	});

	it("reads a padded or upper case all", () => {
		const built = build(
			list(1, [rule("allow", "10.0.0.5"), rule("allow", " ALL ")]),
			list(2, [rule("allow", "10.0.0.6"), rule("allow", " ALL ")]),
		);
		assert.deepEqual(built.clients, [rule("allow", "10.0.0.5"), rule("allow", "10.0.0.6"), rule("allow", "all")]);
	});

	it("keeps the result of a single list", () => {
		assert.deepEqual(build(list(1, [rule("allow", "10.0.0.5"), rule("allow", "all")])).clients, [
			rule("allow", "10.0.0.5"),
			rule("allow", "all"),
		]);
		assert.deepEqual(last(build(list(1, [rule("allow", "10.0.0.5")]))), rule("deny", "all"));
		assert.deepEqual(build(list(1, [rule("allow", "all")])).clients, []);
		assert.deepEqual(build(list(1, [])).clients, []);
		assert.deepEqual(build().clients, []);
	});
});

describe("buildAclFile a lone all rule (D20)", () => {
	it("renders deny all for a list with only deny all", () => {
		assert.deepEqual(build(list(1, [rule("deny", "all")])).clients, [rule("deny", "all")]);
	});

	it("renders no rule for a list with only allow all, with or without users and satisfy any", () => {
		assert.deepEqual(build(list(1, [rule("allow", "all")])).clients, []);
		const users = { items: [{ username: "u", password: "p" }], satisfy_any: true };
		assert.deepEqual(build(list(1, [rule("allow", "all")], users)).clients, []);
	});

	it("keeps the catch-all of mixed lists", () => {
		assert.deepEqual(
			build(list(1, [rule("allow", "all")]), list(2, [rule("allow", "10.0.0.6"), rule("deny", "all")])).clients,
			[rule("allow", "10.0.0.6"), rule("deny", "all")],
		);
		assert.deepEqual(
			build(list(1, [rule("deny", "all")]), list(2, [rule("allow", "10.0.0.0/8"), rule("allow", "all")])).clients,
			[rule("allow", "10.0.0.0/8"), rule("deny", "all")],
		);
		assert.deepEqual(
			build(
				list(1, [rule("allow", "10.0.0.5"), rule("allow", "all")]),
				list(2, [rule("allow", "10.0.0.6"), rule("allow", "all")]),
			).clients,
			[rule("allow", "10.0.0.5"), rule("allow", "10.0.0.6"), rule("allow", "all")],
		);
	});

	it("renders deny all for two lists, one ending with deny all", () => {
		assert.deepEqual(build(list(1, [rule("allow", "all")]), list(2, [rule("deny", "all")])).clients, [
			rule("deny", "all"),
		]);
	});

	it("renders no rule for a list that mixes all rules without a specific address", () => {
		assert.deepEqual(build(list(1, [rule("deny", "all"), rule("allow", "all")])).clients, []);
		assert.deepEqual(build(list(1, [rule("allow", "all"), rule("deny", "all")])).clients, []);
	});

	it("renders no rule for a mixed all list with users and satisfy any", () => {
		const users = { items: [{ username: "u", password: "p" }], satisfy_any: true };
		assert.deepEqual(build(list(1, [rule("allow", "all"), rule("deny", "all")], users)).clients, []);
		assert.deepEqual(build(list(1, [rule("deny", "all"), rule("allow", "all")], users)).clients, []);
	});

	it("renders no rule for a list with users only", () => {
		const built = build(list(1, [], { items: [{ username: "u", password: "p" }], satisfy_any: true }));
		assert.deepEqual(built.clients, []);
	});

	it("keeps satisfy any with users next to a lone deny all", () => {
		const built = build(
			list(1, [rule("deny", "all")], { items: [{ username: "u", password: "p" }], satisfy_any: true }),
		);
		assert.deepEqual(built.clients, [rule("deny", "all")]);
		assert.equal(built.satisfy_any, true);
		assert.equal(built.items.length, 1);
	});
});

describe("buildAclFile geo_gates", () => {
	it("lists the gated lists in order and leaves out off and unset ones", () => {
		const built = build(
			list(1, [], { npmpro_geo_mode: "allow", npmpro_geo_drop: 0 }),
			list(2, [], { npmpro_geo_mode: "off", npmpro_geo_drop: 1 }),
			list(3, [], { npmpro_geo_mode: "deny", npmpro_geo_drop: 1 }),
			list(4, []),
		);
		assert.deepEqual(built.geo_gates, [
			{ id: 1, drop: false },
			{ id: 3, drop: true },
		]);
		assert.deepEqual(build().geo_gates, []);
	});
});
