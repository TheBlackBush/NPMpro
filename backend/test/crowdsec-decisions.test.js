import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isCrowdsecConfigured, parseCrowdsecConf } from "../lib/crowdsec/config.js";
import { fetchDecisions, parseGoDuration, readLimited, summariseDecisions } from "../lib/crowdsec/decisions.js";

const REQUEST_FAILED = /CrowdSec request failed/u;
const TOO_LARGE = /CrowdSec response is too large/u;

const example = readFileSync(new URL("../../rootfs/etc/crowdsec.conf.example", import.meta.url), "utf8");

const sample = [
	{
		id: 1,
		origin: "crowdsec",
		scenario: "crowdsecurity/http-probing",
		scope: "Ip",
		value: "203.0.113.7",
		type: "ban",
		duration: "3h59m2s",
	},
	{
		id: 2,
		origin: "CAPI",
		scenario: "crowdsecurity/ssh-bf",
		scope: "Ip",
		value: "198.51.100.1",
		type: "ban",
		duration: "167h0m0s",
	},
	{ id: 3, origin: "cscli", scenario: "manual", scope: "Range", value: "192.0.2.0/24", type: "ban", duration: "-1h" },
];

describe("parseCrowdsecConf", () => {
	it("reads the example file", () => {
		assert.deepEqual(parseCrowdsecConf(example), {
			enabled: false,
			apiUrl: "http://127.0.0.1:8080",
			apiKey: "",
			useTls: false,
			certFile: "/path/to/client.crt",
			keyFile: "/path/to/client.key",
			sslVerify: true,
		});
	});

	it("handles enabled, spaces, comments and quotes", () => {
		const conf = parseCrowdsecConf(
			'# c\n  ENABLED = true \nAPI_URL=https://lapi:8080\nAPI_KEY="abc def"\n#API_KEY=no\nUSE_TLS_AUTH=TRUE\n',
		);
		assert.equal(conf.enabled, true);
		assert.equal(conf.apiKey, "abc def");
		assert.equal(conf.useTls, true);
		assert.equal(isCrowdsecConfigured(conf), false);
		assert.equal(isCrowdsecConfigured({ ...conf, certFile: "a", keyFile: "b" }), true);
		assert.equal(isCrowdsecConfigured(parseCrowdsecConf(example)), false);
		assert.equal(isCrowdsecConfigured({ enabled: true, apiUrl: "u", apiKey: "k", useTls: false }), true);
	});
});

describe("parseGoDuration", () => {
	it("parses Go durations", () => {
		assert.equal(parseGoDuration("3h59m2s"), 14342);
		assert.equal(parseGoDuration("167h0m0s"), 601200);
		assert.equal(parseGoDuration("1m30.5s"), 90);
		assert.equal(parseGoDuration("500ms"), 0);
		assert.equal(parseGoDuration("1500ms"), 1);
		assert.equal(parseGoDuration("-1h"), 0);
		assert.equal(parseGoDuration("garbage"), 0);
		assert.equal(parseGoDuration(undefined), 0);
	});
});

describe("summariseDecisions", () => {
	const now = 1_000_000_000_000;
	const geo = (ip) => (ip === "203.0.113.7" ? "US" : "DE");

	it("summarises a list", () => {
		const firstSeen = new Map([
			[1, now - 3600_000],
			[2, now - 25 * 3600_000],
		]);
		const s = summariseDecisions(sample, now, geo, firstSeen);
		assert.equal(s.total, 3);
		assert.equal(s.added_24h, 1);
		assert.deepEqual(s.by_type, [{ type: "ban", count: 3 }]);
		assert.equal(s.by_scenario.length, 3);
		assert.deepEqual(s.by_origin.map((o) => o.origin).sort(), ["CAPI", "crowdsec", "cscli"]);
		assert.deepEqual(
			s.newest.map((d) => d.id),
			[3, 2, 1],
		);
		assert.deepEqual(
			s.newest.map((d) => d.seconds_left),
			[0, 601200, 14342],
		);
		assert.deepEqual(
			s.newest.map((d) => d.country),
			[null, "DE", "US"],
		);
		assert.deepEqual(s.countries.map((c) => c.country).sort(), ["DE", "US"]);
	});

	it("sorts counts descending", () => {
		const list = [...sample, { ...sample[1], id: 4 }];
		const s = summariseDecisions(list, now, geo, new Map());
		assert.deepEqual(s.by_scenario[0], { scenario: "crowdsecurity/ssh-bf", count: 2 });
		assert.equal(s.added_24h, 0);
	});

	it("returns zeros for null", () => {
		const s = summariseDecisions(null, now, geo, new Map());
		assert.deepEqual(s, {
			total: 0,
			added_24h: 0,
			by_scenario: [],
			by_origin: [],
			by_type: [],
			newest: [],
			countries: [],
		});
	});

	it("handles 50,000 decisions quickly", () => {
		const list = Array.from({ length: 50_000 }, (_, i) => ({
			id: i + 1,
			origin: "CAPI",
			scenario: `s${i % 50}`,
			scope: "Ip",
			value: `10.0.${i % 250}.${i % 200}`,
			type: "ban",
			duration: "1h",
		}));
		const start = performance.now();
		const s = summariseDecisions(list, now, geo, new Map());
		assert.ok(performance.now() - start < 1000);
		assert.equal(s.total, 50_000);
		assert.equal(s.newest.length, 100);
		assert.equal(s.newest[0].id, 50_000);
	});
});

describe("fetchDecisions (API key)", () => {
	const conf = { apiUrl: "http://lapi:8080/", apiKey: "SECRETKEY", useTls: false, certFile: "", keyFile: "" };
	const stub =
		(res, seen = {}) =>
		async (url, init) => {
			seen.url = url;
			seen.init = init;
			return res;
		};

	it("sends the key header and returns the list", async () => {
		const seen = {};
		const res = { ok: true, status: 200, text: async () => JSON.stringify(sample) };
		const list = await fetchDecisions(conf, { fetch: stub(res, seen) });
		assert.equal(list.length, 3);
		assert.equal(seen.url, "http://lapi:8080/v1/decisions");
		assert.equal(seen.init.headers["X-Api-Key"], "SECRETKEY");
		assert.ok(seen.init.signal);
	});

	it("treats a null body as empty", async () => {
		const res = { ok: true, status: 200, text: async () => "null" };
		assert.deepEqual(await fetchDecisions(conf, { fetch: stub(res) }), []);
	});

	it("reports the status only on errors", async () => {
		const res = { ok: false, status: 403, text: async () => "forbidden SECRETKEY" };
		await assert.rejects(fetchDecisions(conf, { fetch: stub(res) }), (err) => {
			assert.equal(err.message, "CrowdSec answered with status 403");
			return true;
		});
	});

	it("does not leak the key when the request fails", async () => {
		const failing = async () => {
			throw new TypeError("failed SECRETKEY", { cause: { code: "ECONNREFUSED" } });
		};
		await assert.rejects(fetchDecisions(conf, { fetch: failing }), (err) => {
			assert.ok(!err.message.includes("SECRETKEY"));
			assert.match(err.message, /ECONNREFUSED/u);
			return true;
		});
	});
});

describe("fetchDecisions (TLS client certificate)", () => {
	const tlsConf = (dir, extra = {}) => ({
		apiUrl: "https://127.0.0.1:1",
		apiKey: "",
		useTls: true,
		certFile: join(dir, "missing.crt"),
		keyFile: join(dir, "missing.key"),
		...extra,
	});

	it("gives a clear error for a missing cert file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cs-"));
		await assert.rejects(
			fetchDecisions(tlsConf(dir)),
			/Cannot read the CrowdSec TLS client certificate file \(ENOENT\)/u,
		);
	});

	it("requires an https URL", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cs-"));
		writeFileSync(join(dir, "a.pem"), "x");
		await assert.rejects(
			fetchDecisions(
				tlsConf(dir, { apiUrl: "http://x", certFile: join(dir, "a.pem"), keyFile: join(dir, "a.pem") }),
			),
			/needs an https API URL/u,
		);
	});

	it("presents the client cert and verifies the server (self-signed server is rejected)", async (t) => {
		const dir = mkdtempSync(join(tmpdir(), "cs-"));
		const crt = join(dir, "c.crt");
		const key = join(dir, "c.key");
		try {
			execFileSync(
				"openssl",
				[
					"req",
					"-x509",
					"-newkey",
					"rsa:2048",
					"-nodes",
					"-keyout",
					key,
					"-out",
					crt,
					"-days",
					"1",
					"-subj",
					"/CN=127.0.0.1",
				],
				{ stdio: "ignore" },
			);
		} catch {
			t.skip("openssl not available");
			return;
		}
		let clientCertSeen = false;
		const server = https.createServer(
			{ cert: readFileSync(crt), key: readFileSync(key), requestCert: true, rejectUnauthorized: false },
			(req, res) => {
				clientCertSeen = Boolean(req.socket.getPeerCertificate()?.subject);
				res.end("[]");
			},
		);
		await new Promise((r) => server.listen(0, "127.0.0.1", r));
		const apiUrl = `https://127.0.0.1:${server.address().port}`;
		try {
			// ca is not overridden, so the self-signed server certificate must be refused
			await assert.rejects(
				fetchDecisions({ apiUrl, apiKey: "", useTls: true, certFile: crt, keyFile: key }),
				/CrowdSec request failed/u,
			);
			assert.equal(clientCertSeen, false);
		} finally {
			server.close();
		}
	});
});

describe("body handling", () => {
	const conf = { apiUrl: "http://lapi:8080", apiKey: "SECRETKEY", useTls: false };
	const respond =
		(body, headers = {}) =>
		async () => ({
			ok: true,
			status: 200,
			headers: new Headers(headers),
			body,
		});

	it("turns a stalled body into a timed out error", async () => {
		const stalled = (async function* () {
			yield Buffer.from("[");
			await new Promise(() => undefined);
		})();
		await assert.rejects(fetchDecisions(conf, { fetch: respond(stalled), timeoutMs: 50 }), (err) => {
			assert.equal(err.message, "CrowdSec request failed: timed out");
			return true;
		});
	});

	it("rejects an oversize content-length", async () => {
		const fetchFn = respond(
			(async function* () {
				yield Buffer.from("[]");
			})(),
			{ "content-length": String(65 * 1024 * 1024) },
		);
		await assert.rejects(fetchDecisions(conf, { fetch: fetchFn }), /CrowdSec response is too large/u);
	});

	it("rejects an oversize streamed body", async () => {
		const chunk = Buffer.alloc(8 * 1024 * 1024, 32);
		const big = (async function* () {
			for (let i = 0; i < 9; i++) {
				yield chunk;
			}
		})();
		await assert.rejects(fetchDecisions(conf, { fetch: respond(big) }), /CrowdSec response is too large/u);
	});

	it("readLimited enforces the limit and the signal", async () => {
		const parts = (async function* () {
			yield Buffer.from("abc");
			yield Buffer.from("def");
		})();
		await assert.rejects(readLimited(parts, { maxBytes: 5 }), (err) => err.tooLarge === true);
		const ok = (async function* () {
			yield "ab";
			yield Buffer.from("cd");
		})();
		assert.equal(await readLimited(ok, { maxBytes: 4 }), "abcd");
		const stalled = (async function* () {
			await new Promise(() => undefined);
		})();
		const controller = new AbortController();
		setTimeout(() => controller.abort(Object.assign(new Error("x"), { name: "TimeoutError" })), 30);
		await assert.rejects(readLimited(stalled, { signal: controller.signal }), (err) => err.name === "TimeoutError");
	});
});

describe("hardening", () => {
	it("strips inline comments, export, single quotes and CRLF", () => {
		const conf = parseCrowdsecConf(
			"export ENABLED=true # on\r\nAPI_URL=http://x:8080 # lapi\r\nAPI_KEY='a #b'\r\nTLS_CLIENT_CERT=/c.crt\r\n",
		);
		assert.equal(conf.enabled, true);
		assert.equal(conf.apiUrl, "http://x:8080");
		assert.equal(conf.apiKey, "a #b");
		assert.equal(conf.certFile, "/c.crt");
	});

	it("caps absurd durations", () => {
		assert.equal(parseGoDuration("9".repeat(400) + "h"), 0);
		assert.ok(parseGoDuration("99999999999999999999h") <= Number.MAX_SAFE_INTEGER);
	});

	it("looks each IP up once and skips null entries", () => {
		let calls = 0;
		const geo = () => {
			calls++;
			return "US";
		};
		const s = summariseDecisions(
			[null, { id: 1, scope: "Ip", value: "1.1.1.1", scenario: "a" }],
			Date.now(),
			geo,
			new Map(),
		);
		assert.equal(calls, 1);
		assert.equal(s.total, 1);
		assert.deepEqual(s.countries, [{ country: "US", count: 1 }]);
	});
});

describe("SSL_VERIFY", () => {
	it("defaults to true and only an explicit false turns it off", () => {
		assert.equal(parseCrowdsecConf("ENABLED=true").sslVerify, true);
		assert.equal(parseCrowdsecConf("SSL_VERIFY=true").sslVerify, true);
		assert.equal(parseCrowdsecConf("SSL_VERIFY=FALSE").sslVerify, false);
		assert.equal(parseCrowdsecConf('SSL_VERIFY="false" # off').sslVerify, false);
		assert.equal(parseCrowdsecConf("SSL_VERIFY=no").sslVerify, true);
	});

	const selfSigned = () => {
		const dir = mkdtempSync(join(tmpdir(), "cs-"));
		const crt = join(dir, "c.crt");
		const key = join(dir, "c.key");
		try {
			execFileSync(
				"openssl",
				[
					"req",
					"-x509",
					"-newkey",
					"rsa:2048",
					"-nodes",
					"-keyout",
					key,
					"-out",
					crt,
					"-days",
					"1",
					"-subj",
					"/CN=127.0.0.1",
				],
				{ stdio: "ignore" },
			);
		} catch {
			return null;
		}
		return { crt, key };
	};

	const noOpenssl = selfSigned() === null;

	const serve = async (files, handler) => {
		const server = https.createServer(
			{
				cert: readFileSync(files.crt),
				key: readFileSync(files.key),
				requestCert: true,
				rejectUnauthorized: false,
			},
			handler,
		);
		await new Promise((r) => server.listen(0, "127.0.0.1", r));
		return { server, apiUrl: `https://127.0.0.1:${server.address().port}` };
	};

	it("accepts a self-signed LAPI with an API key only when SSL_VERIFY is false", {
		skip: noOpenssl && "openssl not available",
	}, async () => {
		const files = selfSigned();
		let seenKey = null;
		const { server, apiUrl } = await serve(files, (req, res) => {
			seenKey = req.headers["x-api-key"];
			res.end(JSON.stringify([sample[0]]));
		});
		try {
			const conf = { apiUrl, apiKey: "SECRETKEY", useTls: false, certFile: "", keyFile: "" };
			await assert.rejects(fetchDecisions({ ...conf, sslVerify: true }), REQUEST_FAILED);
			assert.equal(seenKey, null);
			const list = await fetchDecisions({ ...conf, sslVerify: false });
			assert.equal(list.length, 1);
			assert.equal(seenKey, "SECRETKEY");
		} finally {
			server.close();
		}
	});

	it("accepts a self-signed LAPI with a TLS client cert when SSL_VERIFY is false", {
		skip: noOpenssl && "openssl not available",
	}, async () => {
		const files = selfSigned();
		let clientCertSeen = false;
		const { server, apiUrl } = await serve(files, (req, res) => {
			clientCertSeen = Boolean(req.socket.getPeerCertificate()?.subject);
			res.end("null");
		});
		try {
			const conf = { apiUrl, apiKey: "", useTls: true, certFile: files.crt, keyFile: files.key };
			await assert.rejects(fetchDecisions({ ...conf, sslVerify: true }), REQUEST_FAILED);
			assert.deepEqual(await fetchDecisions({ ...conf, sslVerify: false }), []);
			assert.equal(clientCertSeen, true);
		} finally {
			server.close();
		}
	});

	it("times out a stalled https response and refuses oversize bodies", {
		skip: noOpenssl && "openssl not available",
	}, async () => {
		const files = selfSigned();
		const { server, apiUrl } = await serve(files, (req, res) => {
			if (req.headers["x-api-key"] === "stall") {
				res.write("[");
				return;
			}
			if (req.headers["x-api-key"] === "length") {
				res.writeHead(200, { "content-length": String(65 * 1024 * 1024) });
				res.write("[");
				return;
			}
			const chunk = Buffer.alloc(8 * 1024 * 1024, 32);
			let sent = 0;
			const push = () => {
				while (sent < 9) {
					sent++;
					if (!res.write(chunk)) {
						res.once("drain", push);
						return;
					}
				}
				res.end();
			};
			push();
		});
		const conf = (apiKey) => ({ apiUrl, apiKey, useTls: false, sslVerify: false });
		try {
			await assert.rejects(fetchDecisions(conf("stall"), { timeoutMs: 100 }), (err) => {
				assert.equal(err.message, "CrowdSec request failed: timed out");
				return true;
			});
			await assert.rejects(fetchDecisions(conf("length")), TOO_LARGE);
			await assert.rejects(fetchDecisions(conf("big")), TOO_LARGE);
		} finally {
			server.closeAllConnections();
			server.close();
		}
	});
});
