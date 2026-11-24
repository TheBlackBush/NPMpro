import assert from "node:assert/strict";
import { it } from "node:test";
import {
	deleteInvalidations,
	HOST_TYPES,
	saveErrorInvalidations,
	saveInvalidations,
	toggleInvalidations,
} from "./HostTypes.js";

it("refreshes the list and the host after an enable or disable", () => {
	assert.deepEqual(toggleInvalidations("dead", 4), [["dead-hosts"], ["dead-host", 4]]);
	assert.deepEqual(toggleInvalidations("redirection", 4), [["redirection-hosts"], ["redirection-host", 4]]);
	assert.deepEqual(toggleInvalidations("stream", 4), [["streams"], ["stream", 4]]);
	assert.deepEqual(toggleInvalidations("proxy", 4), [["proxy-hosts"], ["proxy-host", 4]]);
});

it("refreshes the certificates and the Keep updated suggestions after a delete, and for a proxy host the access lists", () => {
	assert.deepEqual(deleteInvalidations("dead", 4), [
		["dead-hosts"],
		["dead-host", 4],
		["certificates"],
		["ddns-suggestions"],
	]);
	assert.deepEqual(deleteInvalidations("redirection", 4), [
		["redirection-hosts"],
		["redirection-host", 4],
		["certificates"],
		["ddns-suggestions"],
	]);
	assert.deepEqual(deleteInvalidations("stream", 4), [["streams"], ["stream", 4], ["certificates"]]);
	assert.deepEqual(deleteInvalidations("proxy", 4), [
		["proxy-hosts"],
		["proxy-host", 4],
		["certificates"],
		["access-lists"],
		["ddns-suggestions"],
	]);
});

it("refreshes the host, its list, the audit log, the host report, the certificates and the suggestions after a save", () => {
	const common = [["audit-logs"], ["host-report"], ["certificates"]];
	const suggestions = ["ddns-suggestions"];
	assert.deepEqual(saveInvalidations("dead", 4), [["dead-host", 4], ["dead-hosts"], ...common, suggestions]);
	assert.deepEqual(saveInvalidations("redirection", 4), [
		["redirection-host", 4],
		["redirection-hosts"],
		...common,
		suggestions,
	]);
	assert.deepEqual(saveInvalidations("stream", 4), [["stream", 4], ["streams"], ...common]);
	assert.deepEqual(saveInvalidations("proxy", 4), [
		["proxy-host", 4],
		["proxy-hosts"],
		...common,
		["access-lists"],
		suggestions,
	]);
});

it("names the list keys, expand lists, sections and help documents of each type", () => {
	assert.deepEqual(HOST_TYPES.dead.expand, ["owner", "certificate"]);
	assert.deepEqual(HOST_TYPES.redirection.expand, ["owner", "certificate"]);
	assert.deepEqual(HOST_TYPES.stream.expand, ["owner", "certificate"]);
	assert.deepEqual(HOST_TYPES.proxy.expand, ["owner", "access_lists", "certificate"]);
	assert.deepEqual(
		Object.values(HOST_TYPES).map(({ section, kind, help, noDirectory }) => [section, kind, help, noDirectory]),
		[
			["deadHosts", "dead_hosts", "DeadHosts", "dead-host.no-directory"],
			["redirectionHosts", "redirection_hosts", "RedirectionHosts", "redirection-host.no-directory"],
			["streams", "streams", "Streams", "stream.no-directory"],
			["proxyHosts", "proxy_hosts", "ProxyHosts", "proxy-host.no-directory"],
		],
	);
});

it("refreshes after a save whose reload failed as after a save, and nothing after a refused one", () => {
	const reloadFailed = { payload: { error: { message_i18n: "error.nginx-reload-after-save", saved_id: 9 } } };
	assert.deepEqual(saveErrorInvalidations("proxy", reloadFailed), saveInvalidations("proxy", 9));
	assert.deepEqual(saveErrorInvalidations("stream", reloadFailed), saveInvalidations("stream", 9));
	assert.deepEqual(saveErrorInvalidations("dead", { payload: { error: { message: "refused" } } }), []);
	assert.deepEqual(saveErrorInvalidations("dead", new Error("HTTP 502")), []);
});
