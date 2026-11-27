import assert from "node:assert/strict";
import dns from "node:dns";
import http from "node:http";
import { after, before, beforeEach, it } from "node:test";
import { fetch } from "undici";

// no NPMPRO_TEST_ROOT here: providerFetch uses the real guarded agents, so the connect-time lookup is what runs
const { providerFetch } = await import("../lib/ddns/provider-fetch.js");
const { createGuardedAgent } = await import("../lib/outbound-guard.js");

const realLookup = dns.lookup;
let answers = new Map();
let asked = [];
// per name a list of answers (each a list of addresses); the last one repeats
dns.lookup = (hostname, options, callback) => {
	const done = typeof options === "function" ? options : callback;
	asked.push({ hostname, family: options?.family });
	const queue = answers.get(hostname);
	if (!queue && (hostname === "127.0.0.1" || hostname === "::1")) return realLookup(hostname, options, callback);
	if (!queue) return done(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
	const list = queue.length > 1 ? queue.shift() : queue[0];
	const all = list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
	return options?.all ? done(null, all) : done(null, all[0].address, all[0].family);
};

let hits = 0;
let port = 0;
let port6 = 0;
let server;
let server6;
const listen = async (host) => {
	const listener = http.createServer((_req, res) => {
		hits += 1;
		res.end("ok");
	});
	await new Promise((resolve) => listener.listen(0, host, resolve));
	return listener;
};
before(async () => {
	server = await listen("127.0.0.1");
	port = server.address().port;
	server6 = await listen("::1");
	port6 = server6.address().port;
});
beforeEach(() => {
	hits = 0;
	answers = new Map();
	asked = [];
});

after(async () => {
	dns.lookup = realLookup;
	await new Promise((resolve) => server.close(resolve));
	await new Promise((resolve) => server6.close(resolve));
});

const blockedCause = (err) => {
	for (let cause = err; cause; cause = cause.cause) if (cause.code === "EBLOCKED") return true;
	return false;
};
const viaAgent = (name, options) => fetch(`http://${name}:${port}/`, { dispatcher: createGuardedAgent(options) });

it("a name that resolves to the local server is refused at connect, with and without privateOnly", async () => {
	answers.set("local.test", [["127.0.0.1"]]);
	await assert.rejects(viaAgent("local.test"), blockedCause);
	await assert.rejects(viaAgent("local.test", { privateOnly: true }), blockedCause);
	assert.equal(hits, 0);
});

it("providerFetch never reaches the local server by name, over https or allowed http", async () => {
	answers.set("local.test", [["127.0.0.1"]]);
	await assert.rejects(providerFetch(`https://local.test:${port}/`), (err) => err.code === "blocked");
	await assert.rejects(
		providerFetch(`http://local.test:${port}/`, { allowPrivateHttp: true }),
		(err) => err.code === "blocked",
	);
	assert.equal(hits, 0);
});

it("privateOnly refuses an answer that mixes a private and a public address", async () => {
	answers.set("mixed.test", [["192.168.1.5", "8.8.8.8"]]);
	await assert.rejects(viaAgent("mixed.test", { privateOnly: true }), blockedCause);
	await assert.rejects(
		providerFetch(`http://mixed.test:${port}/`, { allowPrivateHttp: true }),
		(err) => err.code === "not-https",
	);
	assert.equal(hits, 0);
});

it("privateOnly refuses a public address, a plain agent refuses a mixed blocked one", async () => {
	answers.set("public.test", [["8.8.8.8"]]);
	await assert.rejects(viaAgent("public.test", { privateOnly: true }), blockedCause);
	answers.set("blend.test", [["8.8.8.8", "127.0.0.1"]]);
	await assert.rejects(viaAgent("blend.test"), blockedCause);
	assert.equal(hits, 0);
});

it("a rebinding flip after the pre-check is refused at connect", async () => {
	for (const flipped of ["127.0.0.1", "8.8.8.8", "169.254.169.254"]) {
		// http: assertAllowedHost and the private check see the LAN address, the connection's own lookup the other
		answers.set("flip.test", [["192.168.1.5"], ["192.168.1.5"], [flipped]]);
		await assert.rejects(
			providerFetch(`http://flip.test:${port}/`, { allowPrivateHttp: true, timeoutMs: 2000 }),
			(err) => err.code === "blocked",
			flipped,
		);
	}
	// https: the pre-check sees a public address, the connection a loopback one
	answers.set("flip.test", [["93.184.216.34"], ["127.0.0.1"]]);
	await assert.rejects(providerFetch(`https://flip.test:${port}/`), (err) => err.code === "blocked");
	assert.equal(hits, 0);
});

it("with family 4 or 6 the lookup asks only for that family", async () => {
	answers.set("fam.test", [["127.0.0.1"]]);
	await assert.rejects(viaAgent("fam.test", { family: 4 }), blockedCause);
	await assert.rejects(viaAgent("fam.test", { family: 6 }), blockedCause);
	await assert.rejects(viaAgent("fam.test"), blockedCause);
	assert.deepEqual(
		asked.filter(({ hostname }) => hostname === "fam.test").map(({ family }) => family),
		[4, 6, undefined],
	);
});

// a connector that records the hosts it is asked for and never opens a socket
const spyBuild = () => {
	const spy = { built: [], hosts: [] };
	spy.build = (options) => {
		spy.built.push(options);
		return (opts, callback) => {
			spy.hosts.push(opts.hostname);
			callback(Object.assign(new Error("not connected"), { code: "ESPY" }), null);
		};
	};
	return spy;
};

it("an IP address of this host is refused before connecting, in every spelling, with and without privateOnly", async () => {
	const urls = [
		`http://127.0.0.1:${port}/`,
		`https://127.0.0.1:${port}/`,
		`http://[::1]:${port6}/`,
		`https://[::1]:${port6}/`,
		`http://[::ffff:127.0.0.1]:${port}/`,
		`http://[::ffff:7f00:1]:${port}/`,
		`http://2130706433:${port}/`,
		`http://0x7f.1:${port}/`,
	];
	for (const privateOnly of [false, true]) {
		for (const url of urls) {
			await assert.rejects(fetch(url, { dispatcher: createGuardedAgent({ privateOnly }) }), blockedCause, url);
		}
	}
	assert.equal(hits, 0);
});

it("the metadata address is refused without connecting anywhere", async () => {
	const spy = spyBuild();
	const agent = createGuardedAgent({}, { build: spy.build });
	await assert.rejects(fetch("http://169.254.169.254/latest/meta-data/", { dispatcher: agent }), blockedCause);
	await assert.rejects(fetch("https://169.254.169.254/", { dispatcher: agent }), blockedCause);
	assert.deepEqual(spy.hosts, []);
});

it("a public IP address goes on to the connect step, privateOnly refuses it there", async () => {
	const spy = spyBuild();
	const agent = createGuardedAgent({ rejectUnauthorized: false, servername: "a.example.test" }, { build: spy.build });
	for (const url of ["https://8.8.8.8/", "https://[2001:4860:4860::8888]/"]) {
		await assert.rejects(fetch(url, { dispatcher: agent }), (err) => err.cause?.code === "ESPY", url);
	}
	assert.deepEqual(spy.hosts, ["8.8.8.8", "2001:4860:4860::8888"]);
	assert.equal(spy.built[0].rejectUnauthorized, false);
	assert.equal(spy.built[0].servername, "a.example.test");

	const strict = spyBuild();
	const lanOnly = createGuardedAgent({ privateOnly: true }, { build: strict.build });
	await assert.rejects(fetch("http://8.8.8.8/", { dispatcher: lanOnly }), blockedCause);
	await assert.rejects(fetch("http://[2001:4860:4860::8888]/", { dispatcher: lanOnly }), blockedCause);
	await assert.rejects(fetch("http://192.168.1.5/", { dispatcher: lanOnly }), (err) => err.cause?.code === "ESPY");
	assert.deepEqual(strict.hosts, ["192.168.1.5"]);
});
