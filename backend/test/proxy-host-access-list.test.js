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

	it("ignores a list without IP rules", () => {
		const built = build(list(1, []), list(2, [rule("deny", "1.2.3.4"), rule("allow", "all")]));
		assert.deepEqual(last(built), rule("allow", "all"));
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
		assert.deepEqual(build().clients, []);
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
