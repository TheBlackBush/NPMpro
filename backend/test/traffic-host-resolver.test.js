import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHostResolver } from "../lib/traffic/host-resolver.js";

const hosts = [
	{ id: 7, type: "dead", domain_names: ["gone.test"] },
	{ id: 1, type: "proxy", domain_names: ["Example.com", "www.example.com"] },
	{ id: 2, type: "proxy", domain_names: ["*.example.com"] },
	{ id: 4, type: "redirection", domain_names: [".old.test", "dup.test"] },
	{ id: 3, type: "proxy", domain_names: ["dup.test"] },
];

describe("host resolver", () => {
	const resolver = createHostResolver(hosts);

	it("maps an exact name to its host, case-insensitively, with the first domain name as name", () => {
		const owner = {
			host_id: 1,
			host_type: "proxy",
			name: "example.com",
			domain_names: ["example.com", "www.example.com"],
		};
		assert.deepEqual(resolver.ownerOf("www.example.com"), owner);
		assert.deepEqual(resolver.ownerOf("EXAMPLE.com"), owner);
	});

	it("maps a wildcard key to the host listing it; keysFor returns only the listed names", () => {
		assert.deepEqual(resolver.ownerOf("*.example.com"), {
			host_id: 2,
			host_type: "proxy",
			name: "*.example.com",
			domain_names: ["*.example.com"],
		});
		assert.deepEqual(resolver.keysFor("proxy", 2), ["*.example.com"]);
		assert.equal(resolver.ownerOf(".old.test").host_id, 4);
		assert.equal(resolver.ownerOf("old.test").host_type, "deleted");
	});

	it("a name listed by two hosts belongs to the first in table order proxy, redirection, dead", () => {
		assert.deepEqual(resolver.ownerOf("dup.test"), {
			host_id: 3,
			host_type: "proxy",
			name: "dup.test",
			domain_names: ["dup.test"],
		});
		assert.deepEqual(resolver.keysFor("redirection", 4), [".old.test"]);
		assert.deepEqual(resolver.keysFor("proxy", 3), ["dup.test"]);
	});

	it("a moved name maps to its current owner", () => {
		const before = createHostResolver([{ id: 1, type: "proxy", domain_names: ["a.test", "moved.test"] }]);
		const after = createHostResolver([
			{ id: 1, type: "proxy", domain_names: ["a.test"] },
			{ id: 9, type: "redirection", domain_names: ["moved.test"] },
		]);
		assert.equal(before.ownerOf("moved.test").host_id, 1);
		assert.deepEqual(after.ownerOf("moved.test"), {
			host_id: 9,
			host_type: "redirection",
			name: "moved.test",
			domain_names: ["moved.test"],
		});
	});

	it("a key no host lists is its own deleted entry; _other is other", () => {
		assert.deepEqual(resolver.ownerOf("removed.test"), {
			host_id: null,
			host_type: "deleted",
			name: "removed.test",
			domain_names: ["removed.test"],
		});
		assert.deepEqual(resolver.ownerOf("_other"), {
			host_id: null,
			host_type: "other",
			name: "_other",
			domain_names: [],
		});
	});

	it("keysFor gives lower-cased names, null for an unknown host or a wrong type", () => {
		assert.deepEqual(resolver.keysFor("proxy", 1), ["example.com", "www.example.com"]);
		assert.deepEqual(resolver.keysFor("dead", 7), ["gone.test"]);
		assert.equal(resolver.keysFor("proxy", 99), null);
		assert.equal(resolver.keysFor("redirection", 1), null);
	});

	it("an empty resolver makes every key a deleted entry", () => {
		const empty = createHostResolver([]);
		assert.equal(empty.ownerOf("example.com").host_type, "deleted");
		assert.equal(empty.ownerOf("_other").host_type, "other");
		assert.deepEqual(empty.hosts(), []);
	});

	it("an ownerOf result can be changed without affecting the resolver", () => {
		resolver.ownerOf("example.com").domain_names.push("x");
		assert.deepEqual(resolver.keysFor("proxy", 1), ["example.com", "www.example.com"]);
	});
});
