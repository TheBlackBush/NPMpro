import assert from "node:assert/strict";
import { it } from "node:test";
import { probeResolvers } from "../lib/resolver-probe.js";

// a fake resolver per address: what resolveNs does for it; cancelled lists the servers whose query was cancelled
const fake =
	(behaviour, cancelled = []) =>
	() => {
		let server;
		return {
			cancel: () => cancelled.push(server),
			setServers: ([address]) => {
				server = address;
				if (behaviour[address] === "throws") throw new Error("bad server");
			},
			resolveNs: () => {
				const what = behaviour[server];
				if (what === "answers") return Promise.resolve(["a.root-servers.net"]);
				if (what === "never") return new Promise(() => {});
				return Promise.reject(Object.assign(new Error(what), { code: what }));
			},
		};
	};

it("returns the addresses that did not answer, in the given order", async () => {
	const createResolver = fake({
		"1.1.1.1": "answers",
		"192.0.2.1": "ETIMEOUT",
		"192.0.2.2": "ECONNREFUSED",
		"192.0.2.3": "ECONNRESET",
		"192.0.2.4": "ECANCELLED",
		"192.0.2.5": "throws",
	});
	const list = ["192.0.2.1", "1.1.1.1", "192.0.2.2", "192.0.2.3", "192.0.2.4", "192.0.2.5"];
	assert.deepEqual(await probeResolvers(list, { createResolver }), [
		"192.0.2.1",
		"192.0.2.2",
		"192.0.2.3",
		"192.0.2.4",
		"192.0.2.5",
	]);
});

it("an error rcode counts as an answer", async () => {
	const createResolver = fake({ "8.8.8.8": "ENOTFOUND", "9.9.9.9": "ENODATA", "[::1]:53": "ESERVFAIL" });
	assert.deepEqual(await probeResolvers(["8.8.8.8", "9.9.9.9", "[::1]:53"], { createResolver }), []);
});

it("a query that never settles ends after the timeout, counts as no answer and is cancelled", async () => {
	const cancelled = [];
	const createResolver = fake({ "192.0.2.9": "never", "1.1.1.1": "answers" }, cancelled);
	const started = Date.now();
	assert.deepEqual(await probeResolvers(["192.0.2.9", "1.1.1.1"], { timeoutMs: 100, createResolver }), ["192.0.2.9"]);
	// a never settling query would hang forever; the bound is wide so a slow CI runner does not fail it
	assert.ok(Date.now() - started < 2000);
	assert.ok(cancelled.includes("192.0.2.9"), "the query the limit gave up on is cancelled");
});

it("a resolver without cancel still gives its result", async () => {
	const createResolver = () => ({ setServers: () => undefined, resolveNs: () => new Promise(() => {}) });
	assert.deepEqual(await probeResolvers(["192.0.2.9"], { timeoutMs: 50, createResolver }), ["192.0.2.9"]);
});

it("an empty list asks nothing", async () => {
	assert.deepEqual(await probeResolvers([], { createResolver: () => assert.fail("asked") }), []);
});

it("a failing createResolver counts as no answer", async () => {
	const createResolver = () => {
		throw new Error("no resolver");
	};
	assert.deepEqual(await probeResolvers(["1.1.1.1"], { createResolver }), ["1.1.1.1"]);
});
