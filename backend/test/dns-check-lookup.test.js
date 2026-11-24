import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { limitConcurrency } from "../lib/dns-check/limit.js";
import { lookup } from "../lib/dns-check/lookup.js";

const fakeResolver = (behaviour) => (options) => {
	const calls = { options, servers: null };
	const answer = (type) => (name) => {
		calls.asked = [...(calls.asked ?? []), `${type} ${name}`];
		const result = behaviour[type];
		return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
	};
	fakeResolver.last = calls;
	return {
		setServers: (servers) => {
			calls.servers = servers;
		},
		resolve4: answer("A"),
		resolve6: answer("AAAA"),
		resolveCaa: answer("CAA"),
	};
};
const failure = (code) => Object.assign(new Error(code), { code });

it("answers the values of each type and passes the resolvers, the timeout and the tries", async () => {
	const make = fakeResolver({ A: ["192.0.2.1"], AAAA: ["2001:db8::1"], CAA: [{ critical: 0, issue: "ca.example" }] });
	assert.deepEqual(await lookup("a.example", "A", ["9.9.9.9"], make), { ok: true, values: ["192.0.2.1"] });
	assert.deepEqual(fakeResolver.last.options, { timeout: 3000, tries: 2 });
	assert.deepEqual(fakeResolver.last.servers, ["9.9.9.9"]);
	assert.deepEqual(await lookup("a.example", "AAAA", [], make), { ok: true, values: ["2001:db8::1"] });
	assert.equal(fakeResolver.last.servers, null);
	assert.deepEqual(await lookup("a.example", "CAA", [], make), {
		ok: true,
		values: [{ critical: 0, issue: "ca.example" }],
	});
});

it("maps the resolver's errors to codes", async () => {
	const codes = {
		ENODATA: "nodata",
		ENOTFOUND: "nxdomain",
		ESERVFAIL: "servfail",
		ETIMEOUT: "timeout",
		ECONNREFUSED: "error",
	};
	for (const [code, expected] of Object.entries(codes)) {
		const make = fakeResolver({ A: failure(code) });
		assert.deepEqual(await lookup("a.example", "A", [], make), { ok: false, code: expected }, code);
	}
	assert.deepEqual(await lookup("a.example", "A", [], fakeResolver({ A: new Error("odd") })), {
		ok: false,
		code: "error",
	});
	assert.deepEqual(await lookup("a.example", "A", [], fakeResolver({ A: [] })), { ok: false, code: "nodata" });
});

it("reads the test map under the test outbound mode and never the network", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "dns-map-"));
	const file = path.join(dir, "map.json");
	await writeFile(
		file,
		JSON.stringify({
			"a.example|A": ["192.0.2.1"],
			"b.example|A": { code: "timeout" },
			"c.example|A": [],
			"e.example|A": { cname: "a.example" },
		}),
	);
	const saved = { ...process.env };
	Object.assign(process.env, { NPMPRO_TEST_ROOT: dir, NPMPRO_TEST_OUTBOUND: "mock", NPMPRO_TEST_DNS: file });
	try {
		const refuse = () => {
			throw new Error("the network must not be asked");
		};
		assert.deepEqual(await lookup("A.example", "A", [], refuse), { ok: true, values: ["192.0.2.1"] });
		assert.deepEqual(await lookup("b.example", "A", [], refuse), { ok: false, code: "timeout" });
		assert.deepEqual(await lookup("c.example", "A", [], refuse), { ok: false, code: "nodata" });
		assert.deepEqual(await lookup("d.example", "A", [], refuse), { ok: false, code: "nxdomain" });
		assert.deepEqual(await lookup("e.example", "A", [], refuse), { ok: true, values: ["192.0.2.1"] });
		process.env.NPMPRO_TEST_DNS = path.join(dir, "missing.json");
		assert.deepEqual(await lookup("a.example", "A", [], refuse), { ok: false, code: "nxdomain" });
	} finally {
		for (const key of ["NPMPRO_TEST_ROOT", "NPMPRO_TEST_OUTBOUND", "NPMPRO_TEST_DNS"]) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
		await rm(dir, { recursive: true, force: true });
	}
});

it("limitConcurrency never runs more than the limit at once and keeps every result", async () => {
	const limit = limitConcurrency(4);
	let active = 0;
	let peak = 0;
	const task = (value) => async () => {
		active += 1;
		peak = Math.max(peak, active);
		await new Promise((resolve) => setTimeout(resolve, 5));
		active -= 1;
		if (value === 7) throw new Error("seven failed");
		return value;
	};
	const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => limit(task(index))));
	assert.equal(peak, 4);
	assert.equal(results.filter((result) => result.status === "fulfilled").length, 19);
	assert.equal(results[7].status, "rejected");
	assert.equal(results[19].value, 19);
});
