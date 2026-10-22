import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSecretBox, SecretBoxError } from "../lib/secret-box.js";

const tempKeyFile = async () => path.join(await mkdtemp(path.join(tmpdir(), "secret-box-")), "key");

test("round trip returns the original object", async () => {
	const box = createSecretBox(await tempKeyFile());
	const value = { fields: { dns_cloudflare_api_token: "abc" } };
	assert.deepEqual(box.decrypt(box.encrypt(value)), value);
});

test("ciphertext has the v1 format and differs per call", async () => {
	const box = createSecretBox(await tempKeyFile());
	const a = box.encrypt({ ini: "x" });
	const b = box.encrypt({ ini: "x" });
	assert.match(a, /^v1:[^:]+:[^:]+:[^:]+$/u);
	assert.notEqual(a, b);
});

test("creates a 32 byte key file with mode 0600 on first use", async () => {
	const keyFile = await tempKeyFile();
	createSecretBox(keyFile).encrypt({ ini: "x" });
	assert.equal((await readFile(keyFile)).length, 32);
	assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
});

test("tampered ciphertext throws SecretBoxError", async () => {
	const box = createSecretBox(await tempKeyFile());
	const [v, iv, tag, data] = box.encrypt({ ini: "x" }).split(":");
	const flipped = Buffer.from(data, "base64");
	flipped[0] ^= 1;
	assert.throws(() => box.decrypt([v, iv, tag, flipped.toString("base64")].join(":")), SecretBoxError);
});

test("a different key throws SecretBoxError", async () => {
	const text = createSecretBox(await tempKeyFile()).encrypt({ ini: "x" });
	const other = createSecretBox(await tempKeyFile());
	other.encrypt({ ini: "create the second key" });
	assert.throws(() => other.decrypt(text), SecretBoxError);
});

test("a missing key file throws SecretBoxError on decrypt", async () => {
	const text = createSecretBox(await tempKeyFile()).encrypt({ ini: "x" });
	const missing = createSecretBox(await tempKeyFile());
	assert.throws(() => missing.decrypt(text), /missing/u);
});

test("unknown format throws SecretBoxError", async () => {
	assert.throws(() => createSecretBox("/nonexistent/key").decrypt("plain text"), SecretBoxError);
});
