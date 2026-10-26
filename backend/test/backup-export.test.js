import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import knexFactory from "knex";
import { exportStage, verifyStage } from "../lib/backup/export.js";

process.env.TZ = "UTC";

const META = {
	npmproVersion: "1.0.0",
	dbVersion: "20261023180000",
	createdBy: { name: "Admin", email: "a@example.com" },
	createdAt: "2026-10-26T10:00:00.000Z",
};
const TYPES = ["proxy_hosts", "dns_credentials", "custom_nginx", "certificates"];

const sqlite = async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	await knex.schema.createTable("proxy_host", (t) => {
		t.increments("id");
		t.json("domain_names");
	});
	await knex.schema.createTable("npmpro_location", (t) => {
		t.increments("id");
		t.integer("proxy_host_id");
	});
	await knex.schema.createTable("npmpro_proxy_host_access_list", (t) => {
		t.integer("proxy_host_id");
		t.integer("location_id");
		t.integer("access_list_id");
	});
	await knex.schema.createTable("npmpro_dns_credential", (t) => {
		t.increments("id");
		t.string("name");
		t.text("values");
	});
	await knex.schema.createTable("certificate", (t) => {
		t.increments("id");
		t.string("provider");
	});
	await knex("proxy_host").insert({ domain_names: '["a.example.com"]' });
	await knex("npmpro_dns_credential").insert({ name: "cf", values: "v1:sealed" });
	await knex("certificate").insert({ provider: "letsencrypt" });
	return knex;
};

const put = async (file, content) => {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, content);
};

const setup = async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "npmpro-export-"));
	const dataDir = path.join(root, "data");
	const stageDir = path.join(root, "stage");
	await put(path.join(dataDir, "custom_nginx/http.conf"), "# conf");
	await put(path.join(dataDir, "tls/certbot/archive/npm-1/privkey1.pem"), "PRIVATE");
	await put(path.join(dataDir, "tls/certbot/archive/npm-1/cert1.pem"), "CERT");
	await put(path.join(dataDir, "tls/certbot/archive/npm-2x/cert1.pem"), "NOPE");
	await put(path.join(dataDir, "keys-ec.json"), "SECRET");
	return { root, dataDir, stageDir };
};

const run = async (knex, paths, extra) =>
	exportStage({ knex, box: { decrypt: () => ({ token: "t" }) }, types: TYPES, meta: META, ...paths, ...extra });

it("exports a stage without secrets", async () => {
	const knex = await sqlite();
	const paths = await setup();
	const { manifest, summary } = await run(knex, paths, { secrets: false });
	const proxy = JSON.parse(await readFile(path.join(paths.stageDir, "data/proxy_hosts.json"), "utf8"));
	assert.deepEqual(proxy.proxy_host[0].domain_names, ["a.example.com"]);
	const dns = JSON.parse(await readFile(path.join(paths.stageDir, "data/dns_credentials.json"), "utf8"));
	assert.deepEqual(dns.npmpro_dns_credential[0].values, {});
	assert.ok(existsSync(path.join(paths.stageDir, "files/custom_nginx/http.conf")));
	assert.ok(existsSync(path.join(paths.stageDir, "files/tls/certbot/archive/npm-1/cert1.pem")));
	assert.ok(!existsSync(path.join(paths.stageDir, "files/tls/certbot/archive/npm-1/privkey1.pem")));
	assert.ok(!existsSync(path.join(paths.stageDir, "files/tls/certbot/archive/npm-2x")));
	assert.ok(!existsSync(path.join(paths.stageDir, "files/keys-ec.json")));
	assert.equal(manifest.secrets, false);
	assert.deepEqual(
		manifest.files.map((f) => f.path),
		["files/custom_nginx/http.conf", "files/tls/certbot/archive/npm-1/cert1.pem"],
	);
	assert.equal(manifest.files[1].sha256, createHash("sha256").update("CERT").digest("hex"));
	assert.equal(manifest.files[1].size, 4);
	assert.equal(manifest.counts.proxy_hosts, 1);
	assert.equal(manifest.counts.custom_nginx, 1);
	assert.equal(manifest.counts.certificates, 1);
	assert.deepEqual(summary.types, TYPES);
	assert.equal(JSON.parse(await readFile(path.join(paths.stageDir, "manifest.json"), "utf8")).format, 1);
	await verifyStage(paths.stageDir, manifest);
	await knex.destroy();
	await rm(paths.root, { recursive: true });
});

it("exports secrets when asked to", async () => {
	const knex = await sqlite();
	const paths = await setup();
	const { manifest } = await run(knex, paths, { secrets: true });
	const dns = JSON.parse(await readFile(path.join(paths.stageDir, "data/dns_credentials.json"), "utf8"));
	assert.deepEqual(dns.npmpro_dns_credential[0].values, { token: "t" });
	assert.ok(existsSync(path.join(paths.stageDir, "files/tls/certbot/archive/npm-1/privkey1.pem")));
	assert.equal(manifest.secrets, true);
	await knex.destroy();
	await rm(paths.root, { recursive: true });
});

it("skips a symlink under custom_nginx", async () => {
	const knex = await sqlite();
	const paths = await setup();
	await symlink("/etc/passwd", path.join(paths.dataDir, "custom_nginx/link.conf"));
	await symlink(paths.dataDir, path.join(paths.dataDir, "custom_nginx/dir-link"));
	const { manifest } = await run(knex, paths, { secrets: false });
	assert.ok(!existsSync(path.join(paths.stageDir, "files/custom_nginx/link.conf")));
	assert.ok(!existsSync(path.join(paths.stageDir, "files/custom_nginx/dir-link")));
	assert.equal(manifest.counts.custom_nginx, 1);
	await verifyStage(paths.stageDir, manifest);
	await knex.destroy();
	await rm(paths.root, { recursive: true });
});

const INVALID = { code: "invalid-archive" };

it("verifyStage refuses a changed byte, an extra file, a missing file and a stray data file", async () => {
	const knex = await sqlite();
	const paths = await setup();
	const { manifest } = await run(knex, paths, { secrets: false });
	const conf = path.join(paths.stageDir, "files/custom_nginx/http.conf");
	await writeFile(conf, "# c0nf");
	await assert.rejects(verifyStage(paths.stageDir, manifest), INVALID);
	await writeFile(conf, "# conf");
	await verifyStage(paths.stageDir, manifest);

	const extra = path.join(paths.stageDir, "files/custom_nginx/extra.conf");
	await writeFile(extra, "x");
	await assert.rejects(verifyStage(paths.stageDir, manifest), INVALID);
	await rm(extra);

	const stray = path.join(paths.stageDir, "data/users.json");
	await writeFile(stray, "{}");
	await assert.rejects(verifyStage(paths.stageDir, manifest), INVALID);
	await rm(stray);

	await rm(conf);
	await assert.rejects(verifyStage(paths.stageDir, manifest), INVALID);
	await knex.destroy();
	await rm(paths.root, { recursive: true });
});

it("verifyStage refuses manifest paths outside files/", async () => {
	const knex = await sqlite();
	const paths = await setup();
	const { manifest } = await run(knex, paths, { secrets: false });
	for (const bad of [
		"../manifest.json",
		"files/../manifest.json",
		"/etc/passwd",
		"data/proxy_hosts.json",
		"files//a",
		"files/./a",
	]) {
		const tampered = { ...manifest, files: [...manifest.files, { path: bad, size: 0, sha256: "" }] };
		await assert.rejects(verifyStage(paths.stageDir, tampered), INVALID);
	}
	await knex.destroy();
	await rm(paths.root, { recursive: true });
});
