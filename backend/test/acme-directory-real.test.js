import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, it } from "node:test";
import { makeCertificate } from "./support/certbot.js";

// No MockAgent here: the directory is read from a real local HTTPS server (self-signed certificate) through the
// agent the code builds, so a fetch that does not accept that agent (Node's built-in one with the npm undici's) fails.
delete process.env.NPMPRO_TEST_OUTBOUND;
const { clearAcmeDirectoryCache, readAcmeDirectory } = await import("../lib/acme-directory.js");

const DIRECTORY = {
	newNonce: "https://localhost/nonce",
	meta: { externalAccountRequired: true, profiles: { classic: "The default" } },
};
let dir;
let server;
let url;

before(async () => {
	dir = await mkdtemp(path.join(tmpdir(), "acme-dir-real-"));
	const { key, certificate } = await makeCertificate(dir, "localhost");
	server = https.createServer({ key: await readFile(key), cert: await readFile(certificate) }, (_, res) => {
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify(DIRECTORY));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	url = `https://127.0.0.1:${server.address().port}/dir`;
});
after(async () => {
	await new Promise((resolve) => server.close(resolve));
	await rm(dir, { recursive: true, force: true });
});

it("reads a directory from a real server through the agent of a TLS-off read", async () => {
	clearAcmeDirectoryCache();
	const result = await readAcmeDirectory(url, { guarded: false, verify: false, fresh: true });
	assert.equal(result.reachable, true, result.error);
	assert.equal(result.directory, true);
	assert.equal(result.external_account_required, true);
	assert.deepEqual(result.profiles, { classic: "The default" });
});

it("does not read a self-signed certificate when TLS is verified", async () => {
	const result = await readAcmeDirectory(url, { guarded: false, verify: true, fresh: true });
	assert.equal(result.reachable, false);
	assert.notEqual(result.error, "UND_ERR_INVALID_ARG");
});
