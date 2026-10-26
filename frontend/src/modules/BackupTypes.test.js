import assert from "node:assert/strict";
import { it } from "node:test";
import { categoryState, DEFAULT_SELECTED, toggleCategory, toggleType } from "./BackupTypes.js";

const hosts = { id: "hosts", types: ["proxy_hosts", "streams", "dead_hosts"] };
const settings = { id: "settings", types: ["settings_runtime", "settings_oidc"] };

it("categoryState is all, some or none", () => {
	assert.equal(categoryState(hosts, []), "none");
	assert.equal(categoryState(hosts, ["settings_oidc"]), "none");
	assert.equal(categoryState(hosts, ["streams"]), "some");
	assert.equal(categoryState(hosts, ["streams", "proxy_hosts", "dead_hosts", "settings_oidc"]), "all");
});

it("toggleCategory selects the rest of a partial category and clears a full one", () => {
	assert.deepEqual(toggleCategory(hosts, []), ["proxy_hosts", "streams", "dead_hosts"]);
	assert.deepEqual(toggleCategory(hosts, ["streams", "settings_oidc"]), [
		"streams",
		"settings_oidc",
		"proxy_hosts",
		"dead_hosts",
	]);
	assert.deepEqual(toggleCategory(hosts, ["proxy_hosts", "streams", "dead_hosts", "settings_oidc"]), [
		"settings_oidc",
	]);
});

it("toggleType adds or removes one type and does not mutate the input", () => {
	const selected = ["streams"];
	assert.deepEqual(toggleType("proxy_hosts", selected), ["streams", "proxy_hosts"]);
	assert.deepEqual(toggleType("streams", selected), []);
	assert.deepEqual(selected, ["streams"]);
});

it("DEFAULT_SELECTED lists every type", () => {
	assert.deepEqual(DEFAULT_SELECTED([hosts, settings]), [
		"proxy_hosts",
		"streams",
		"dead_hosts",
		"settings_runtime",
		"settings_oidc",
	]);
	assert.deepEqual(DEFAULT_SELECTED([]), []);
});
