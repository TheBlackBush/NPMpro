import assert from "node:assert/strict";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { it } from "node:test";
import { extractTo } from "../lib/backup/archive.js";
import { openBackupFile } from "../lib/backup/format.js";
import { CATEGORIES } from "../lib/backup/types.js";
import errs from "../lib/error.js";
import { craftBackup } from "./support/backup-craft.js";
import { setup } from "./support/backup-service.js";

process.env.TZ = "UTC";

const TIMEOUT = { timeout: 60_000 };
const PASSPHRASE = "correct horse battery staple";
const ALL_TYPES = CATEGORIES.flatMap((category) => category.types);
const EXPORT_NAME = /^npmpro-export-proxy-hosts-test-host-\d{8}-\d{6}\.npmpro$/u;
const COPIED_NAME = "npmpro-backup-other-20261027-120000.npmpro";
const admin = {
	isAdmin: true,
	canAdmin: () => true,
	can: () => true,
	visibility: "all",
	token: { getUserId: () => 1 },
};

// a user who is no administrator, with these permissions ({ proxy_hosts: "manage", certificates: "view" })
const userAccess = (userId, permissions, visibility = "all") => ({
	canAdmin: () => {
		throw new errs.PermissionError();
	},
	can: (permission) => {
		const [type, required] = permission.split(":");
		const level = permissions[type];
		if (level === "manage" || level === required) return true;
		throw new errs.PermissionError();
	},
	visibility,
	token: { getUserId: () => userId },
});

const hasCode = (code) => (error) => error.code === code;

const certificateFiles = async (dataDir, id, label) => {
	const archive = path.join(dataDir, "tls/certbot/archive", `npm-${id}`);
	await mkdir(archive, { recursive: true });
	for (const name of ["cert1.pem", "chain1.pem", "fullchain1.pem", "privkey1.pem"]) {
		await writeFile(path.join(archive, name), `${name} of ${label}\n`);
	}
	const live = path.join(dataDir, "tls/certbot/live", `npm-${id}`);
	await mkdir(live, { recursive: true });
	for (const name of ["cert", "chain", "fullchain", "privkey"]) {
		await symlink(`../../archive/npm-${id}/${name}1.pem`, path.join(live, `${name}.pem`));
	}
};

// a host with its own certificate #1 on an instance
const seedHost = async (ctx, label) => {
	await ctx.knex("certificate").insert({
		id: 1,
		provider: "letsencrypt",
		nice_name: label,
		domain_names: JSON.stringify([`${label}.example.com`]),
	});
	await certificateFiles(ctx.dataDir, 1, label);
	await ctx.knex("proxy_host").insert({
		id: 1,
		domain_names: JSON.stringify([`${label}.example.com`]),
		certificate_id: 1,
	});
};

// a backup of instance A as a file outside both instances
const backupOf = async (ctx, { types = ALL_TYPES, secrets = true } = {}) => {
	const { pending } = await ctx.service.create(admin, {
		types,
		secrets,
		passphrase: secrets ? PASSPHRASE : undefined,
		keep: false,
	});
	const file = path.join(ctx.base, "copy.npmpro");
	await copyFile(ctx.service.takePending(admin, pending), file);
	return file;
};

// the file stored in the instance's backups and opened there by the admin
const openOn = async (ctx, file, passphrase = PASSPHRASE) => {
	await copyFile(file, path.join(ctx.backupsDir, COPIED_NAME));
	return ctx.service.inspect(admin, COPIED_NAME, { passphrase });
};

const twoInstances = async (options = {}) => {
	const a = await setup();
	const b = await setup(options);
	await seedHost(a, "a");
	await seedHost(b, "b");
	return {
		a,
		b,
		cleanup: async () => {
			await a.cleanup();
			await b.cleanup();
		},
	};
};

const domainsOf = async (knex, table) =>
	(await knex(table).orderBy("id").select("id", "domain_names")).map((row) => [
		Number(row.id),
		JSON.parse(row.domain_names)[0],
	]);

const autoFiles = async (ctx) => {
	const folder = path.join(ctx.backupsDir, "auto");
	return existsSync(folder) ? await readdir(folder) : [];
};

it("merges a full backup of another instance: its hosts are added, the instance's stay", TIMEOUT, async () => {
	const { a, b, cleanup } = await twoInstances();
	try {
		const { token, manifest } = await openOn(b, await backupOf(a));
		const types = manifest.types;
		const plan = await b.service.plan(admin, token, { mode: "merge", types });
		const host = plan.items.find((item) => item.key === "proxy_hosts:1");
		assert.equal(host.action, "add");
		const result = await b.service.restore(admin, token, { mode: "merge", types, planHash: plan.hash });
		assert.equal(result.counts.proxy_hosts, 1);
		assert.equal(result.counts.certificates, 1);
		assert.deepEqual(result.cleared, []);
		assert.deepEqual(await domainsOf(b.knex, "proxy_host"), [
			[1, "b.example.com"],
			[2, "a.example.com"],
		]);
		assert.deepEqual(await domainsOf(b.knex, "certificate"), [
			[1, "b.example.com"],
			[2, "a.example.com"],
		]);
		assert.equal(Number((await b.knex("proxy_host").where({ id: 2 }).first()).certificate_id), 2);
		const archive = path.join(b.dataDir, "tls/certbot/archive");
		assert.equal(await readFile(path.join(archive, "npm-2/cert1.pem"), "utf8"), "cert1.pem of a\n");
		assert.equal(await readFile(path.join(archive, "npm-1/cert1.pem"), "utf8"), "cert1.pem of b\n");
		assert.ok(existsSync(path.join(b.dataDir, "tls/certbot/live/npm-2/cert.pem")));
		assert.equal(b.calls.test, 1);
		assert.equal(b.calls.reload, 1);
		assert.equal((await autoFiles(b)).length, 1);
		assert.deepEqual([b.calls.pause, b.calls.resume, b.isPaused()], [1, 1, false]);
		const merged = b.calls.audit.find((entry) => entry.action === "merged");
		assert.equal(merged.object_type, "backup");
		assert.equal(merged.meta.name, COPIED_NAME);
		assert.equal(merged.meta.automatic_backup, (await autoFiles(b))[0]);
		// the session is used up
		await assert.rejects(b.service.plan(admin, token, { mode: "merge", types }), hasCode("token-expired"));
	} finally {
		await cleanup();
	}
});

it("refuses a merge whose plan hash is stale and returns the current plan", TIMEOUT, async () => {
	const { a, b, cleanup } = await twoInstances();
	try {
		const { token, manifest } = await openOn(b, await backupOf(a));
		const types = manifest.types;
		await assert.rejects(b.service.restore(admin, token, { mode: "merge", types, planHash: "stale" }), (error) => {
			assert.equal(error.code, "plan-changed");
			assert.equal(error.status, 409);
			assert.ok(Array.isArray(error.payload.plan.items));
			assert.equal(typeof error.payload.plan.hash, "string");
			return true;
		});
		assert.deepEqual(await domainsOf(b.knex, "proxy_host"), [[1, "b.example.com"]]);
		assert.deepEqual(await autoFiles(b), []);
		assert.equal(b.calls.test, 0);
		assert.equal(
			b.calls.audit.some((entry) => entry.action === "merged"),
			false,
		);
		// the session stays open for the new plan
		const plan = await b.service.plan(admin, token, { mode: "merge", types });
		await b.service.restore(admin, token, { mode: "merge", types, planHash: plan.hash });
		assert.equal((await domainsOf(b.knex, "proxy_host")).length, 2);
	} finally {
		await cleanup();
	}
});

it("refuses a merge when a clashing host was added after the plan", TIMEOUT, async () => {
	const { a, b, cleanup } = await twoInstances();
	try {
		const { token, manifest } = await openOn(b, await backupOf(a));
		const types = manifest.types;
		const plan = await b.service.plan(admin, token, { mode: "merge", types });
		await b.knex("dead_host").insert({ id: 7, domain_names: '["a.example.com"]' });
		await assert.rejects(
			b.service.restore(admin, token, { mode: "merge", types, planHash: plan.hash }),
			(error) => {
				assert.equal(error.code, "plan-changed");
				const host = error.payload.plan.items.find((item) => item.key === "proxy_hosts:1");
				assert.equal(host.action, "skip");
				assert.equal(host.reason, "domain-in-use");
				return true;
			},
		);
		assert.deepEqual(await domainsOf(b.knex, "proxy_host"), [[1, "b.example.com"]]);
	} finally {
		await cleanup();
	}
});

it("rolls a merge back when nginx rejects the merged configuration", TIMEOUT, async () => {
	const { a, b, cleanup } = await twoInstances({
		test: (call) => {
			if (call === 1) throw new Error("nginx: [emerg] cannot load certificate");
		},
	});
	try {
		const { token, manifest } = await openOn(b, await backupOf(a));
		const types = manifest.types;
		const plan = await b.service.plan(admin, token, { mode: "merge", types });
		await assert.rejects(
			b.service.restore(admin, token, { mode: "merge", types, planHash: plan.hash }),
			hasCode("nginx-failed"),
		);
		assert.deepEqual(await domainsOf(b.knex, "proxy_host"), [[1, "b.example.com"]]);
		assert.deepEqual(await domainsOf(b.knex, "certificate"), [[1, "b.example.com"]]);
		assert.equal(existsSync(path.join(b.dataDir, "tls/certbot/archive/npm-2")), false);
		assert.equal(existsSync(path.join(b.dataDir, "tls/certbot/live/npm-2")), false);
		assert.equal(
			await readFile(path.join(b.dataDir, "tls/certbot/archive/npm-1/cert1.pem"), "utf8"),
			"cert1.pem of b\n",
		);
		assert.ok(existsSync(path.join(b.dataDir, "tls/certbot/live/npm-1/cert.pem")));
		assert.deepEqual([b.calls.pause, b.calls.resume, b.isPaused()], [1, 1, false]);
		assert.equal(
			b.calls.audit.some((entry) => entry.action === "merged"),
			false,
		);
	} finally {
		await cleanup();
	}
});

it("refuses to replace with a partial file", TIMEOUT, async () => {
	const { a, b, cleanup } = await twoInstances();
	try {
		const { pending } = await a.service.exportItems(admin, {
			kind: "proxy_hosts",
			ids: [1],
			linked: { certificates: [1] },
			secrets: false,
		});
		const file = path.join(a.base, "export.npmpro");
		await copyFile(a.service.takePending(admin, pending), file);
		const { token, manifest } = await openOn(b, file, undefined);
		assert.equal(manifest.partial, true);
		await assert.rejects(
			b.service.restore(admin, token, { mode: "replace", types: manifest.types }),
			hasCode("partial-replace"),
		);
		assert.deepEqual(await domainsOf(b.knex, "proxy_host"), [[1, "b.example.com"]]);
	} finally {
		await cleanup();
	}
});

it("imports a host on its page; a certificate the user cannot manage is not added", TIMEOUT, async () => {
	const { a, b, cleanup } = await twoInstances();
	try {
		await b.knex("user").insert([
			{ id: 2, email: "two@example.com", name: "Two", roles: "[]" },
			{ id: 3, email: "three@example.com", name: "Three", roles: "[]" },
		]);
		const importer = userAccess(2, { proxy_hosts: "manage", certificates: "view" });
		const file = await backupOf(a, { types: ["proxy_hosts", "certificates"] });
		const { id } = await b.service.importUpload(importer, createReadStream(file), { kind: "proxy_hosts" });
		const opened = await b.service.importOpen(importer, id, { passphrase: PASSPHRASE });
		const certificate = opened.plan.items.find((item) => item.key === "certificates:1");
		assert.equal(certificate.action, "skip");
		const other = userAccess(3, { proxy_hosts: "manage", certificates: "manage" });
		await assert.rejects(
			b.service.plan(other, opened.token, { mode: "merge", types: ["proxy_hosts", "certificates"] }),
			hasCode("token-expired"),
		);
		const result = await b.service.restore(importer, opened.token, {
			mode: "merge",
			types: ["proxy_hosts"],
			planHash: opened.plan.hash,
		});
		assert.deepEqual(result.counts, { proxy_hosts: 1 });
		assert.deepEqual(
			result.cleared.map((link) => [link.key, link.column, link.from]),
			[["proxy_hosts:1", "certificate_id", 1]],
		);
		const host = await b.knex("proxy_host").where({ id: 2 }).first();
		assert.equal(JSON.parse(host.domain_names)[0], "a.example.com");
		assert.equal(Number(host.certificate_id), 0);
		assert.equal(Number(host.owner_user_id), 2);
		assert.deepEqual(await domainsOf(b.knex, "certificate"), [[1, "b.example.com"]]);
		const imported = b.calls.audit.find((entry) => entry.action === "imported");
		assert.equal(imported.object_type, "proxy-host");
		assert.deepEqual(imported.meta.counts, { proxy_hosts: 1 });
	} finally {
		await cleanup();
	}
});

it(
	"imports a host on its page with its certificate as a linked item, linked to the added certificate",
	TIMEOUT,
	async () => {
		const { a, b, cleanup } = await twoInstances();
		try {
			const file = await backupOf(a, { types: ["proxy_hosts", "certificates"] });
			const { id } = await b.service.importUpload(admin, createReadStream(file), { kind: "proxy_hosts" });
			const opened = await b.service.importOpen(admin, id, { passphrase: PASSPHRASE });
			const certificate = opened.plan.items.find((item) => item.key === "certificates:1");
			assert.equal(certificate.linked, true);
			assert.deepEqual(certificate.needed_by, ["proxy_hosts:1"]);
			assert.equal(certificate.action, "add");
			// a page import selects only its kind: linked kinds come along through the hosts that need them
			await assert.rejects(
				b.service.plan(admin, opened.token, { mode: "merge", types: ["proxy_hosts", "certificates"] }),
				hasCode("invalid-types"),
			);
			const plan = await b.service.plan(admin, opened.token, { mode: "merge", types: ["proxy_hosts"] });
			assert.equal(plan.hash, opened.plan.hash);
			const result = await b.service.restore(admin, opened.token, {
				mode: "merge",
				types: ["proxy_hosts"],
				planHash: opened.plan.hash,
			});
			assert.deepEqual(result.counts, { proxy_hosts: 1, certificates: 1 });
			assert.deepEqual(result.cleared, []);
			assert.deepEqual(await domainsOf(b.knex, "certificate"), [
				[1, "b.example.com"],
				[2, "a.example.com"],
			]);
			assert.equal(Number((await b.knex("proxy_host").where({ id: 2 }).first()).certificate_id), 2);
		} finally {
			await cleanup();
		}
	},
);

it(
	"imports a host on its page whose certificate matches: the host uses the existing certificate",
	TIMEOUT,
	async () => {
		const { a, b, cleanup } = await twoInstances();
		try {
			// the certificate of A covers the domain of B's certificate
			await a
				.knex("certificate")
				.where({ id: 1 })
				.update({ domain_names: JSON.stringify(["b.example.com"]) });
			const file = await backupOf(a, { types: ["proxy_hosts", "certificates"] });
			const { id } = await b.service.importUpload(admin, createReadStream(file), { kind: "proxy_hosts" });
			const opened = await b.service.importOpen(admin, id, { passphrase: PASSPHRASE });
			const certificate = opened.plan.items.find((item) => item.key === "certificates:1");
			assert.equal(certificate.linked, true);
			assert.equal(certificate.action, "existing");
			const result = await b.service.restore(admin, opened.token, {
				mode: "merge",
				types: ["proxy_hosts"],
				planHash: opened.plan.hash,
			});
			assert.deepEqual(result.counts, { proxy_hosts: 1 });
			assert.deepEqual(await domainsOf(b.knex, "certificate"), [[1, "b.example.com"]]);
			assert.equal(Number((await b.knex("proxy_host").where({ id: 2 }).first()).certificate_id), 1);
		} finally {
			await cleanup();
		}
	},
);

it("exports a host with its certificate, secrets only with manage permission", TIMEOUT, async () => {
	const a = await setup();
	const out = await mkdtemp(path.join(os.tmpdir(), "backup-export-"));
	try {
		await seedHost(a, "a");
		await a.knex("user").insert({ id: 2, email: "two@example.com", name: "Two", roles: "[]" });
		const viewer = userAccess(2, { proxy_hosts: "manage", certificates: "view" });
		const preview = await a.service.exportPreview(viewer, { kind: "proxy_hosts", ids: [1] });
		assert.deepEqual(preview.items, [{ id: 1, label: "a.example.com" }]);
		assert.deepEqual(preview.linked, [
			{ type: "certificates", id: 1, label: "a.example.com", needed_by: ["proxy_hosts:1"] },
		]);
		assert.equal(preview.secretsAllowed, false);
		await assert.rejects(
			a.service.exportItems(viewer, {
				kind: "proxy_hosts",
				ids: [1],
				linked: { certificates: [1] },
				secrets: true,
				passphrase: PASSPHRASE,
			}),
			(error) => error instanceof errs.PermissionError,
		);
		const { pending, name } = await a.service.exportItems(viewer, {
			kind: "proxy_hosts",
			ids: [1],
			linked: { certificates: [1] },
			secrets: false,
		});
		assert.match(name, EXPORT_NAME);
		const file = a.service.takePending(viewer, pending);
		await extractTo({ source: await openBackupFile({ file }), dir: out, allow: () => true });
		const manifest = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8"));
		assert.equal(manifest.partial, true);
		assert.deepEqual(manifest.items, { proxy_hosts: [1], certificates: [1] });
		const hosts = JSON.parse(await readFile(path.join(out, "data/proxy_hosts.json"), "utf8"));
		assert.deepEqual(
			hosts.proxy_host.map((row) => row.id),
			[1],
		);
		const certificates = JSON.parse(await readFile(path.join(out, "data/certificates.json"), "utf8"));
		assert.deepEqual(
			certificates.certificate.map((row) => row.id),
			[1],
		);
		const paths = manifest.files.map((entry) => entry.path);
		assert.ok(paths.includes("files/tls/certbot/archive/npm-1/cert1.pem"));
		assert.equal(
			paths.some((rel) => rel.includes("privkey")),
			false,
		);
		const exported = a.calls.audit.find((entry) => entry.action === "exported");
		assert.equal(exported.object_type, "proxy-host");
	} finally {
		await a.cleanup();
		await rm(out, { recursive: true, force: true });
	}
});

it("refuses to open an import whose file lacks the page's kind", TIMEOUT, async () => {
	const { a, b, cleanup } = await twoInstances();
	try {
		const file = await backupOf(a, { types: ["proxy_hosts"], secrets: false });
		const { id } = await b.service.importUpload(admin, createReadStream(file), { kind: "streams" });
		await assert.rejects(b.service.importOpen(admin, id, {}), hasCode("wrong-kind"));
		assert.deepEqual(
			(await readdir(b.backupsDir)).filter((name) => name.startsWith(".")),
			[],
		);
	} finally {
		await cleanup();
	}
});

it("keeps a page import upload after a wrong or missing passphrase", TIMEOUT, async () => {
	const { a, b, cleanup } = await twoInstances();
	try {
		await b.knex("user").insert([
			{ id: 2, email: "two@example.com", name: "Two", roles: "[]" },
			{ id: 3, email: "three@example.com", name: "Three", roles: "[]" },
		]);
		const importer = userAccess(2, { proxy_hosts: "manage", certificates: "manage" });
		const other = userAccess(3, { proxy_hosts: "manage", certificates: "manage" });
		const file = await backupOf(a, { types: ["proxy_hosts", "certificates"] });
		const { id, encrypted } = await b.service.importUpload(importer, createReadStream(file), {
			kind: "proxy_hosts",
		});
		assert.equal(encrypted, true);
		await assert.rejects(
			b.service.importOpen(importer, id, { passphrase: "a wrong passphrase here" }),
			hasCode("wrong-passphrase"),
		);
		await assert.rejects(b.service.importOpen(importer, id, {}), hasCode("wrong-passphrase"));
		await assert.rejects(b.service.importOpen(other, id, { passphrase: PASSPHRASE }), hasCode("token-expired"));
		const opened = await b.service.importOpen(importer, id, { passphrase: PASSPHRASE });
		assert.equal(typeof opened.token, "string");
		// used up once opened
		await assert.rejects(b.service.importOpen(importer, id, { passphrase: PASSPHRASE }), hasCode("token-expired"));
		assert.deepEqual(
			(await readdir(b.backupsDir)).filter((name) => name.startsWith(".pending-")),
			[],
		);
	} finally {
		await cleanup();
	}
});

it("refuses an automatic backup and a too large file for a page import", TIMEOUT, async () => {
	const { a, b, cleanup } = await twoInstances({ maxImport: 64 * 1024 });
	try {
		// a merge on A leaves its automatic backup
		const { token, manifest } = await openOn(a, await backupOf(b));
		const plan = await a.service.plan(admin, token, { mode: "merge", types: manifest.types });
		await a.service.restore(admin, token, { mode: "merge", types: manifest.types, planHash: plan.hash });
		const [auto] = await autoFiles(a);
		const dotFiles = async () => (await readdir(b.backupsDir)).filter((name) => name.startsWith("."));
		const before = await dotFiles();
		await assert.rejects(
			b.service.importUpload(admin, createReadStream(path.join(a.backupsDir, "auto", auto)), {
				kind: "proxy_hosts",
			}),
			(error) => {
				assert.equal(error.code, "not-importable");
				assert.equal(error.status, 400);
				return true;
			},
		);
		await assert.rejects(
			b.service.importUpload(admin, Readable.from([Buffer.alloc(100 * 1024)]), { kind: "proxy_hosts" }),
			(error) => {
				assert.equal(error.code, "too-large");
				assert.equal(error.status, 413);
				assert.equal(error.message, "The file is larger than 200 MB");
				return true;
			},
		);
		// neither upload is kept
		assert.deepEqual(await dotFiles(), before);
	} finally {
		await cleanup();
	}
});

it("an own items export leaves out a linked certificate of another user", TIMEOUT, async () => {
	const a = await setup();
	try {
		await seedHost(a, "a");
		await a.knex("user").insert({ id: 2, email: "two@example.com", name: "Two", roles: "[]" });
		await a.knex("proxy_host").where({ id: 1 }).update({ owner_user_id: 2 });
		const own = userAccess(2, { proxy_hosts: "manage", certificates: "manage" }, "user");
		const preview = await a.service.exportPreview(own, { kind: "proxy_hosts" });
		assert.deepEqual(preview.items, [{ id: 1, label: "a.example.com" }]);
		assert.deepEqual(preview.linked, []);
		const { pending } = await a.service.exportItems(own, {
			kind: "proxy_hosts",
			ids: [1],
			linked: { certificates: [1] },
			secrets: false,
		});
		const file = a.service.takePending(own, pending);
		const out = path.join(a.base, "out");
		await mkdir(out);
		await extractTo({ source: await openBackupFile({ file }), dir: out, allow: () => true });
		const manifestOut = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8"));
		assert.deepEqual(manifestOut.types, ["proxy_hosts"]);
		assert.deepEqual(manifestOut.items, { proxy_hosts: [1] });
	} finally {
		await a.cleanup();
	}
});

it("refuses a file whose certificate id is a path before anything moves", TIMEOUT, async () => {
	const { a, b, cleanup } = await twoInstances();
	try {
		const crafted = await craftBackup(
			await backupOf(a, { types: ["proxy_hosts", "certificates"] }),
			path.join(a.base, "crafted.npmpro"),
			async ({ data, writeData }) => {
				const certificates = await data("certificates");
				certificates.certificate[0].id = "1/../../../../x";
				await writeData("certificates", certificates);
			},
			{ passphrase: PASSPHRASE },
		);
		const { id } = await b.service.importUpload(admin, createReadStream(crafted), { kind: "proxy_hosts" });
		await assert.rejects(b.service.importOpen(admin, id, {}), hasCode("invalid-archive"));
		assert.deepEqual(await autoFiles(b), []);
		assert.deepEqual(await domainsOf(b.knex, "certificate"), [[1, "b.example.com"]]);
		assert.deepEqual(await readdir(path.join(b.dataDir, "tls/certbot/archive")), ["npm-1"]);
	} finally {
		await cleanup();
	}
});

const ACCOUNT_A = "a".repeat(32);
const accountDir = (id) => `tls/certbot/accounts/acme-v02.api.letsencrypt.org/directory/${id}`;
const HOOK = /hook/u;
const LABEL_A = /a\.example\.com/u;

// a backup of A's host and certificate whose renewal conf and ACME account were changed by hand
const craftedCertificate = async (a, renewal) =>
	craftBackup(
		await backupOf(a, { types: ["proxy_hosts", "certificates"] }),
		path.join(a.base, "crafted.npmpro"),
		async ({ dir, write }) => {
			await mkdir(path.join(dir, "files/tls/certbot/renewal"), { recursive: true });
			await write("tls/certbot/renewal/npm-1.conf", renewal);
			await mkdir(path.join(dir, "files", accountDir(ACCOUNT_A)), { recursive: true });
			await write(`${accountDir(ACCOUNT_A)}/private_key.json`, "{}");
		},
		{ passphrase: PASSPHRASE },
	);

it("a page import rebuilds the renewal conf and a non-admin import places no account files", TIMEOUT, async () => {
	const { a, b, cleanup } = await twoInstances();
	try {
		await b.knex("user").insert({ id: 2, email: "two@example.com", name: "Two", roles: "[]" });
		const importer = userAccess(2, { proxy_hosts: "manage", certificates: "manage" });
		const crafted = await craftedCertificate(
			a,
			`[renewalparams]\naccount = ${ACCOUNT_A}\nauthenticator = webroot\nconfig_dir = /etc\ndeploy_hook = rm -rf /\n`,
		);
		const { id } = await b.service.importUpload(importer, createReadStream(crafted), { kind: "proxy_hosts" });
		const opened = await b.service.importOpen(importer, id, {});
		await b.service.restore(importer, opened.token, {
			mode: "merge",
			types: ["proxy_hosts"],
			planHash: opened.plan.hash,
		});
		const conf = await readFile(path.join(b.dataDir, "tls/certbot/renewal/npm-2.conf"), "utf8");
		assert.doesNotMatch(conf, HOOK);
		assert.equal(conf.includes(`config_dir = ${b.dataDir}/tls/certbot`), true);
		// the account was not placed, so the conf does not name it
		assert.equal(conf.includes("account"), false);
		assert.equal(existsSync(path.join(b.dataDir, accountDir(ACCOUNT_A))), false);
	} finally {
		await cleanup();
	}
});

it("an admin page import places the missing account its renewal conf names", TIMEOUT, async () => {
	const { a, b, cleanup } = await twoInstances();
	try {
		const crafted = await craftedCertificate(
			a,
			`[renewalparams]\naccount = ${ACCOUNT_A}\nauthenticator = webroot\n`,
		);
		const { id } = await b.service.importUpload(admin, createReadStream(crafted), { kind: "proxy_hosts" });
		const opened = await b.service.importOpen(admin, id, {});
		await b.service.restore(admin, opened.token, {
			mode: "merge",
			types: ["proxy_hosts"],
			planHash: opened.plan.hash,
		});
		const conf = await readFile(path.join(b.dataDir, "tls/certbot/renewal/npm-2.conf"), "utf8");
		assert.equal(conf.includes(`account = ${ACCOUNT_A}`), true);
		assert.equal(existsSync(path.join(b.dataDir, accountDir(ACCOUNT_A), "private_key.json")), true);
	} finally {
		await cleanup();
	}
});

it("refuses a page import whose certificate has a renewal conf with an unknown authenticator", TIMEOUT, async () => {
	const { a, b, cleanup } = await twoInstances();
	try {
		// biome-ignore lint/security/noSecrets: a renewal conf sample, not a secret
		const crafted = await craftedCertificate(a, "[renewalparams]\nauthenticator = manual\n");
		const { id } = await b.service.importUpload(admin, createReadStream(crafted), { kind: "proxy_hosts" });
		await assert.rejects(b.service.importOpen(admin, id, {}), (error) => {
			assert.equal(error.code, "invalid-item");
			assert.match(error.message, LABEL_A);
			return true;
		});
		assert.deepEqual(await autoFiles(b), []);
	} finally {
		await cleanup();
	}
});

// a file of A's host #1 changed in A's database first (no API checks there)
const hostFileWith = async (a, values) => {
	await a.knex("proxy_host").where({ id: 1 }).update(values);
	return backupOf(a, { types: ["proxy_hosts"], secrets: false });
};

const invalidItem = (label, field) => (error) =>
	error.code === "invalid-item" &&
	error.status === 400 &&
	error.public === true &&
	error.message.includes(label) &&
	error.message.includes(field);

it("refuses a non-admin page import of a host with advanced config; an admin imports it", TIMEOUT, async () => {
	const { a, b, cleanup } = await twoInstances();
	try {
		await b.knex("user").insert({ id: 2, email: "two@example.com", name: "Two", roles: "[]" });
		const importer = userAccess(2, { proxy_hosts: "manage" });
		const file = await hostFileWith(a, { advanced_config: "location /x { content_by_lua_block { } }" });
		const upload = await b.service.importUpload(importer, createReadStream(file), { kind: "proxy_hosts" });
		await assert.rejects(
			b.service.importOpen(importer, upload.id, {}),
			invalidItem("a.example.com", "advanced_config"),
		);
		assert.deepEqual(await autoFiles(b), []);
		assert.deepEqual(await domainsOf(b.knex, "proxy_host"), [[1, "b.example.com"]]);
		assert.deepEqual(
			(await readdir(b.backupsDir)).filter((name) => name.startsWith(".")),
			[],
		);
		const { id } = await b.service.importUpload(admin, createReadStream(file), { kind: "proxy_hosts" });
		const opened = await b.service.importOpen(admin, id, {});
		await b.service.restore(admin, opened.token, {
			mode: "merge",
			types: ["proxy_hosts"],
			planHash: opened.plan.hash,
		});
		assert.deepEqual(await domainsOf(b.knex, "proxy_host"), [
			[1, "b.example.com"],
			[2, "a.example.com"],
		]);
	} finally {
		await cleanup();
	}
});

it("refuses a non-admin page import of a host whose domain or forward host holds nginx syntax", TIMEOUT, async () => {
	const { a, b, cleanup } = await twoInstances();
	try {
		await b.knex("user").insert({ id: 2, email: "two@example.com", name: "Two", roles: "[]" });
		const importer = userAccess(2, { proxy_hosts: "manage" });
		const cases = [
			[{ domain_names: JSON.stringify(["a.example.com;include /etc/passwd"]) }, "domain_names"],
			[{ forward_host: "app;\n}" }, "forward_host"],
			[{ forward_scheme: "path", forward_host: "/etc" }, "forward_host"],
			[{ forward_port: 70_000 }, "forward_port"],
		];
		for (const [values, field] of cases) {
			const file = await hostFileWith(a, values);
			const { id } = await b.service.importUpload(importer, createReadStream(file), { kind: "proxy_hosts" });
			await assert.rejects(b.service.importOpen(importer, id, {}), invalidItem("#1", field));
			await a
				.knex("proxy_host")
				.where({ id: 1 })
				.update({
					domain_names: JSON.stringify(["a.example.com"]),
					forward_host: "",
					forward_scheme: "http",
					forward_port: 80,
				});
		}
		assert.deepEqual(await domainsOf(b.knex, "proxy_host"), [[1, "b.example.com"]]);
	} finally {
		await cleanup();
	}
});

const ACCOUNT_B = "b".repeat(32);

// instance A's certificate #1 names account A in its renewal conf; the instance also has account B
const seedAccounts = async (a) => {
	await mkdir(path.join(a.dataDir, "tls/certbot/renewal"), { recursive: true });
	await writeFile(
		path.join(a.dataDir, "tls/certbot/renewal/npm-1.conf"),
		`[renewalparams]\naccount = ${ACCOUNT_A}\nauthenticator = webroot\n`,
	);
	for (const account of [ACCOUNT_A, ACCOUNT_B]) {
		await mkdir(path.join(a.dataDir, accountDir(account)), { recursive: true });
		for (const name of ["meta.json", "regr.json", "private_key.json"]) {
			await writeFile(path.join(a.dataDir, accountDir(account), name), "{}");
		}
	}
};

const exportedPaths = async (ctx, access, secrets) => {
	const { pending } = await ctx.service.exportItems(access, {
		kind: "proxy_hosts",
		ids: [1],
		linked: { certificates: [1] },
		secrets,
		passphrase: secrets ? PASSPHRASE : undefined,
	});
	const out = await mkdtemp(path.join(ctx.base, "out-"));
	const file = ctx.service.takePending(access, pending);
	await extractTo({
		source: await openBackupFile({ file, passphrase: PASSPHRASE }),
		dir: out,
		allow: () => true,
	});
	const manifest = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8"));
	return manifest.files.map((entry) => entry.path);
};

it("a page export holds ACME accounts only for an admin with secrets, and only the named ones", TIMEOUT, async () => {
	const a = await setup();
	try {
		await seedHost(a, "a");
		await seedAccounts(a);
		await a.knex("user").insert({ id: 2, email: "two@example.com", name: "Two", roles: "[]" });
		const manager = userAccess(2, { proxy_hosts: "manage", certificates: "manage" });
		const accounts = (paths) => paths.filter((rel) => rel.includes("/accounts/"));
		assert.deepEqual(accounts(await exportedPaths(a, manager, true)), []);
		assert.deepEqual(accounts(await exportedPaths(a, admin, false)), []);
		assert.deepEqual(
			accounts(await exportedPaths(a, admin, true)),
			["meta.json", "private_key.json", "regr.json"].map((name) => `files/${accountDir(ACCOUNT_A)}/${name}`),
		);
	} finally {
		await a.cleanup();
	}
});
