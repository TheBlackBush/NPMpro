import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";

const HELPER = new URL("../../rootfs/usr/local/bin/acme-status.sh", import.meta.url).pathname;
const LE = "https://acme-v02.api.letsencrypt.org/directory";
const LE_STAGING = "https://acme-staging-v02.api.letsencrypt.org/directory";
const V01 = "acme-v01.api.letsencrypt.org/directory";
const V02 = "acme-v02.api.letsencrypt.org/directory";
const ID_A = "a".repeat(32);
const ID_B = "b".repeat(32);
const EMAIL = "admin@example.test";
const CA_LINE = "ACME CA:      ";
const NOT_REGISTERED =
	"ACME account: not registered yet: registers when saved in Settings, Certificates, or at the first";
const BAR = "-------------------------------------";

const accounts = () => mkdtemp(path.join(tmpdir(), "acme-status-"));

const addAccount = async (root, rel, id, mtimeSeconds) => {
	const dir = path.join(root, rel, id);
	await mkdir(dir, { recursive: true });
	const key = path.join(dir, "private_key.json");
	await writeFile(key, "{}");
	await utimes(key, mtimeSeconds, mtimeSeconds);
};

const status = (server, source, dir, flags = {}) =>
	spawnSync("sh", ["-c", '. "$HELPER"; acme_status "$S" "$SRC" "$DIR" "$EM" "$EAB"'], {
		encoding: "utf8",
		env: {
			PATH: process.env.PATH,
			HELPER,
			S: server,
			SRC: source,
			DIR: dir,
			EM: String(flags.email ?? false),
			EAB: String(flags.eab ?? false),
		},
	}).stdout;

const line = (out, index) => out.split("\n")[index];

it("shows a Let's Encrypt account found under the acme-v01 folder", async () => {
	const dir = await accounts();
	await addAccount(dir, V01, ID_A, 1000);
	assert.equal(
		status(LE, "default", dir),
		`${CA_LINE}Let's Encrypt (${LE}), from the default\nACME account: registered (aaaaaaaa)\nACME email:   not set\n${BAR}\n`,
	);
});

it("finds an account under an acme-v02 symlink to the v01 folder", async () => {
	const dir = await accounts();
	await addAccount(dir, V01, ID_A, 1000);
	await mkdir(path.join(dir, "acme-v02.api.letsencrypt.org"));
	await symlink(path.join(dir, V01), path.join(dir, V02));
	assert.equal(line(status(LE, "default", dir), 1), "ACME account: registered (aaaaaaaa)");
});

it("finds a staging account under its reused folder", async () => {
	const dir = await accounts();
	await addAccount(dir, "acme-staging.api.letsencrypt.org/directory", ID_A, 1000);
	const out = status(LE_STAGING, "env", dir);
	assert.equal(line(out, 0), `${CA_LINE}Let's Encrypt staging (${LE_STAGING}), from the environment`);
	assert.equal(line(out, 1), "ACME account: registered (aaaaaaaa)");
});

it("takes the newest of several accounts", async () => {
	const dir = await accounts();
	await addAccount(dir, V02, ID_A, 1000);
	await addAccount(dir, V02, ID_B, 2000);
	assert.equal(line(status(LE, "default", dir), 1), "ACME account: registered (bbbbbbbb)");
	await addAccount(dir, V01, ID_A, 3000);
	assert.equal(line(status(LE, "default", dir), 1), "ACME account: registered (aaaaaaaa)");
});

it("says not registered yet for a missing folder, an empty folder and a stray id", async () => {
	const dir = await accounts();
	assert.ok(line(status(LE, "default", dir), 1).startsWith(NOT_REGISTERED));
	assert.ok(line(status(LE, "default", path.join(dir, "missing")), 1).startsWith(NOT_REGISTERED));
	await mkdir(path.join(dir, V02, "not-an-id"), { recursive: true });
	await writeFile(path.join(dir, V02, "not-an-id", "private_key.json"), "{}");
	assert.ok(line(status(LE, "default", dir), 1).startsWith(NOT_REGISTERED));
});

it("names the known CAs and a custom one, and keeps accounts per CA", async () => {
	const dir = await accounts();
	const zero = "https://acme.zerossl.com/v2/DV90";
	const google = "https://dv.acme-v02.api.pki.goog/directory";
	const custom = "https://ca.example.test:14000/dir";
	await addAccount(dir, "acme.zerossl.com/v2/DV90", ID_A, 1000);
	assert.equal(line(status(zero, "settings", dir), 0), `${CA_LINE}ZeroSSL (${zero}), from Settings`);
	assert.equal(
		line(status(google, "default", dir), 0),
		`${CA_LINE}Google Trust Services (${google}), from the default`,
	);
	const out = status(custom, "env", dir);
	assert.equal(line(out, 0), `${CA_LINE}Custom CA (${custom}), from the environment`);
	assert.ok(line(out, 1).startsWith(NOT_REGISTERED));
	await addAccount(dir, "ca.example.test:14000/dir", ID_B, 1000);
	assert.equal(line(status(custom, "env", dir), 1), "ACME account: registered (bbbbbbbb)");
});

it("names each source", async () => {
	const dir = await accounts();
	for (const [source, text] of [
		["env", "from the environment"],
		["settings", "from Settings"],
		["default", "from the default"],
	]) {
		assert.ok(line(status(LE, source, dir), 0).endsWith(text), source);
	}
});

it("never prints the email address, set or not, and prints the EAB line only when both are set", async () => {
	const dir = await accounts();
	const set = status(LE, "env", dir, { email: true, eab: true });
	assert.equal(line(set, 2), "ACME email:   set");
	assert.equal(line(set, 3), "ACME EAB:     set");
	assert.ok(!(set.includes(EMAIL) || set.includes("@")));
	const unset = status(LE, "env", dir);
	assert.equal(line(unset, 2), "ACME email:   not set");
	assert.ok(!unset.includes("EAB"));
});
