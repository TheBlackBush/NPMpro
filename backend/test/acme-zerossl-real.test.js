import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, it } from "node:test";
import { createGuardedAgent } from "../lib/outbound-guard.js";
import { makeCertificate } from "./support/certbot.js";

// No MockAgent here: the ZeroSSL EAB request is a real POST to a local HTTPS server (self-signed certificate) through
// real undici agents, so a fetch that does not accept them, or a body ZeroSSL would not read, fails.
delete process.env.NPMPRO_TEST_OUTBOUND;
const { dispatcherFor, zeroSslEab } = await import("../lib/acme-directory.js");

let dir;
let server;
let port;
const received = [];

before(async () => {
	dir = await mkdtemp(path.join(tmpdir(), "zerossl-real-"));
	const { key, certificate } = await makeCertificate(dir, "localhost");
	server = https.createServer({ key: await readFile(key), cert: await readFile(certificate) }, (req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			received.push({ method: req.method, url: req.url, type: req.headers["content-type"], body });
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ success: true, eab_kid: "real-kid", eab_hmac_key: "real-hmac" }));
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	port = server.address().port;
});
after(async () => {
	await new Promise((resolve) => server.close(resolve));
	await rm(dir, { recursive: true, force: true });
});

it("fetches an EAB pair with a real POST through the trusted agent", async () => {
	received.length = 0;
	const pair = await zeroSslEab("ops@example.com", {
		url: `https://127.0.0.1:${port}/acme/eab-credentials-email`,
		dispatcher: dispatcherFor({ guarded: false, verify: false }),
	});
	assert.deepEqual(pair, { kid: "real-kid", hmac: "real-hmac" });
	assert.equal(received.length, 1);
	assert.equal(received[0].method, "POST");
	assert.equal(received[0].url, "/acme/eab-credentials-email");
	assert.match(received[0].type, /^application\/x-www-form-urlencoded/u);
	assert.equal(new URLSearchParams(received[0].body).get("email"), "ops@example.com");
});

it("is refused by the guarded agent for a name on this host, without reaching it", async () => {
	received.length = 0;
	await assert.rejects(
		zeroSslEab("ops@example.com", {
			url: `https://localhost:${port}/acme/eab-credentials-email`,
			dispatcher: createGuardedAgent({ rejectUnauthorized: false }),
		}),
		(err) => err.message_i18n === "error.acme-zerossl",
	);
	assert.equal(received.length, 0);
});
