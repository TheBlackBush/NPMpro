import assert from "node:assert/strict";
import { it } from "node:test";
import { camelizeKeys, decamelizeKeys } from "./caseConvert.js";

it("camelizes nested keys", () => {
	assert.deepEqual(camelizeKeys({ top_ips: [{ last_seen: 1 }] }), { topIps: [{ lastSeen: 1 }] });
});

it("does not throw on keys ending in a separator", () => {
	assert.deepEqual(camelizeKeys({ "--": 1, a_: 2 }), { "": 1, a: 2 });
});

it("decamelizes keys", () => {
	assert.deepEqual(decamelizeKeys({ topIps: 1 }), { top_ips: 1 });
});

it("keeps the keys of rawKeys maps and camelizes everything else", () => {
	const data = {
		certificate_kinds: { letsencrypt: 1, other: 2 },
		counts: { proxy_hosts: 3, settings_oidc: 1 },
		entries: [{ created_at: 1, summary: { counts: { dns_credentials: 2 }, npmpro_version: "1" } }],
	};
	assert.deepEqual(camelizeKeys(data, { rawKeys: ["counts", "certificate_kinds"] }), {
		certificateKinds: { letsencrypt: 1, other: 2 },
		counts: { proxy_hosts: 3, settings_oidc: 1 },
		entries: [{ createdAt: 1, summary: { counts: { dns_credentials: 2 }, npmproVersion: "1" } }],
	});
	assert.deepEqual(camelizeKeys({ counts: { proxy_hosts: 3 } }), { counts: { proxyHosts: 3 } });
});

it("keeps the keys of items and choices maps in a request", () => {
	const data = {
		planHash: "abc",
		types: ["proxy_hosts"],
		items: { proxy_hosts: [3], dns_credentials: [1] },
		choices: { "proxy_hosts:3": "replace", "file:custom_nginx/MyFile.conf": "take", "setting:oidc": "skip" },
	};
	assert.deepEqual(decamelizeKeys(data, { rawKeys: ["items", "choices"] }), {
		plan_hash: "abc",
		types: ["proxy_hosts"],
		items: { proxy_hosts: [3], dns_credentials: [1] },
		choices: { "proxy_hosts:3": "replace", "file:custom_nginx/MyFile.conf": "take", "setting:oidc": "skip" },
	});
	assert.deepEqual(decamelizeKeys({ choices: { "file:MyFile.conf": "take" } }), {
		choices: { "file:_my_file.conf": "take" },
	});
});

it("keeps the keys of the items map of a manifest and leaves the plan items array alone", () => {
	const data = {
		manifest: { items: { proxy_hosts: [{ id: 3, domain_names: ["a"] }] }, created_at: 1 },
		plan: { items: [{ key: "proxy_hosts:3", needed_by: [], choices: ["add", "skip"] }], cleared_links: 0 },
	};
	assert.deepEqual(camelizeKeys(data, { rawKeys: ["items", "choices"] }), {
		manifest: { items: { proxy_hosts: [{ id: 3, domainNames: ["a"] }] }, createdAt: 1 },
		plan: { items: [{ key: "proxy_hosts:3", neededBy: [], choices: ["add", "skip"] }], clearedLinks: 0 },
	});
});
