import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { createSecretBox, SecretBoxError } from "../lib/secret-box.js";

const v1Format = /^v1:[^:]+:[^:]+:[^:]+$/u;
const missingKey = /missing/u;
const unreadableKey = /cannot be read/u;

const tempKeyFile = async () => path.join(await mkdtemp(path.join(tmpdir(), "secret-box-")), "key");

it("round trip returns the original object", async () => {
	const box = createSecretBox(await tempKeyFile());
	const value = { fields: { dns_cloudflare_api_token: "abc" } };
	assert.deepEqual(box.decrypt(box.encrypt(value)), value);
});

it("ciphertext has the v1 format and differs per call", async () => {
	const box = createSecretBox(await tempKeyFile());
	const a = box.encrypt({ ini: "x" });
	const b = box.encrypt({ ini: "x" });
	assert.match(a, v1Format);
	assert.notEqual(a, b);
});

it("creates a 32 byte key file with mode 0600 on first use", async () => {
	const keyFile = await tempKeyFile();
	createSecretBox(keyFile).encrypt({ ini: "x" });
	assert.equal((await readFile(keyFile)).length, 32);
	assert.equal((await stat(keyFile)).mode.toString(8).endsWith("600"), true);
});

it("tampered ciphertext throws SecretBoxError", async () => {
	const box = createSecretBox(await tempKeyFile());
	const [v, iv, tag, data] = box.encrypt({ ini: "x" }).split(":");
	const flipped = Buffer.from(data, "base64");
	flipped[0] = (flipped[0] + 1) % 256;
	assert.throws(() => box.decrypt([v, iv, tag, flipped.toString("base64")].join(":")), SecretBoxError);
});

it("truncated auth tag throws SecretBoxError", async () => {
	const box = createSecretBox(await tempKeyFile());
	const [v, iv, tag, data] = box.encrypt({ ini: "x" }).split(":");
	const shortTag = Buffer.from(tag, "base64").subarray(0, 4).toString("base64");
	assert.throws(() => box.decrypt([v, iv, shortTag, data].join(":")), SecretBoxError);
});

it("a different key throws SecretBoxError", async () => {
	const text = createSecretBox(await tempKeyFile()).encrypt({ ini: "x" });
	const other = createSecretBox(await tempKeyFile());
	other.encrypt({ ini: "create the second key" });
	assert.throws(() => other.decrypt(text), SecretBoxError);
});

it("a missing key file throws SecretBoxError on decrypt", async () => {
	const text = createSecretBox(await tempKeyFile()).encrypt({ ini: "x" });
	const missing = createSecretBox(await tempKeyFile());
	assert.throws(() => missing.decrypt(text), missingKey);
});

it("an unreadable key file throws SecretBoxError on decrypt", async () => {
	const text = createSecretBox(await tempKeyFile()).encrypt({ ini: "x" });
	const keyFile = await tempKeyFile();
	await mkdir(keyFile, { recursive: true });
	const unreadable = createSecretBox(keyFile);
	assert.throws(() => unreadable.decrypt(text), unreadableKey);
});

it("unknown format throws SecretBoxError", () => {
	assert.throws(() => createSecretBox("/nonexistent/key").decrypt("plain text"), SecretBoxError);
});
