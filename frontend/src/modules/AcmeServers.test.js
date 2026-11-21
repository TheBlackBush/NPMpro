import assert from "node:assert/strict";
import { it } from "node:test";
import { caOptions, defaultCa, showCaSelect } from "./AcmeServers.js";

const LE = "https://acme-v02.api.letsencrypt.org/directory";
const ZERO = "https://acme.zerossl.com/v2/DV90";
const servers = [
	{ server: LE, preset: "letsencrypt", state: "registered", instance: true },
	{ server: ZERO, preset: "zerossl", state: "failed", instance: false },
	{ server: "https://ca.example.com/dir", preset: null, state: "none", instance: false },
];

it("shows the select only with more than one CA", () => {
	assert.equal(showCaSelect(undefined), false);
	assert.equal(showCaSelect([]), false);
	assert.equal(showCaSelect(servers.slice(0, 1)), false);
	assert.equal(showCaSelect(servers.slice(0, 2)), true);
});

it("defaults to the instance CA, nothing while the list is missing", () => {
	assert.equal(defaultCa(servers), LE);
	assert.equal(defaultCa(undefined), "");
});

it("labels the options and marks the default and the CAs not connected yet", () => {
	assert.deepEqual(caOptions(servers), [
		{ value: LE, labelId: "acme.preset.letsencrypt", isDefault: true, notConnected: false },
		{ value: ZERO, labelId: "acme.preset.zerossl", isDefault: false, notConnected: true },
		{ value: "https://ca.example.com/dir", text: "ca.example.com", isDefault: false, notConnected: true },
	]);
});

it("leaves the excluded CA out and keeps a pending one connectable", () => {
	const list = [...servers.slice(0, 1), { ...servers[1], state: "pending" }];
	assert.deepEqual(
		caOptions(list, LE).map((option) => [option.value, option.notConnected]),
		[[ZERO, false]],
	);
	assert.deepEqual(caOptions(undefined), []);
});
