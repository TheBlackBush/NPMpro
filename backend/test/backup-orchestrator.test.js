import assert from "node:assert/strict";
import { existsSync, readlinkSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { it } from "node:test";
import knexFactory from "knex";
import { createBackupService, unknownMigrations } from "../internal/backup.js";
import { createSerializer } from "../internal/monitoring-update.js";
import { writeBackupFile } from "../lib/backup/format.js";
import { createBackupStore } from "../lib/backup/store.js";

process.env.TZ = "UTC";

const TIMEOUT = { timeout: 60_000 };
const PASSPHRASE = "correct horse battery staple";
const DB_VERSION = "20261026000000";
const MIGRATIONS = ["20180618015850_initial.js", "20261026000000_base.js"];
const AUTO_NAME = /^npmpro-backup-test-host-\d{8}-\d{6}-auto\.npmpro$/u;
const PLAIN_NAME = /^npmpro-backup-test-host-\d{8}-\d{6}\.npmpro$/u;
const UNKNOWN_DIRECTIVE = /unknown directive/u;
const AUTO_IN_MESSAGE = /npmpro-backup-test-host-\d{8}-\d{6}-auto\.npmpro/u;
const UPLOAD_NAME = /^npmpro-backup-upload-\d{8}-\d{6}\.npmpro$/u;
const box = { encrypt: (value) => `v1:${JSON.stringify(value)}`, decrypt: (value) => JSON.parse(value.slice(3)) };
const access = { canAdmin: () => true, token: { getUserId: () => 1 } };
const silent = { info: () => {}, warn: () => {}, error: () => {} };

const createSchema = async (knex) => {
	const hostTable = (name, extra = () => {}) =>
		knex.schema.createTable(name, (t) => {
			t.increments("id");
			t.integer("owner_user_id").notNull().defaultTo(1);
			t.json("domain_names").notNull().defaultTo("[]");
			t.integer("enabled").notNull().defaultTo(1);
			t.integer("certificate_id").notNull().defaultTo(0);
			t.json("meta").notNull().defaultTo("{}");
			t.integer("npmpro_nginx_online").notNull().defaultTo(1);
			t.text("npmpro_nginx_err").notNull().defaultTo("");
			extra(t);
		});
	await knex.schema.createTable("user", (t) => {
		t.increments("id");
		t.string("email").notNull();
		t.string("name").notNull();
		t.json("roles").notNull();
		t.integer("npmpro_token_valid_after").notNull().defaultTo(0);
	});
	await knex.schema.createTable("auth", (t) => {
		t.increments("id");
		t.integer("user_id").notNull();
		t.string("type").notNull();
		t.string("secret").notNull();
		t.json("meta").notNull();
	});
	await knex.schema.createTable("user_permission", (t) => {
		t.increments("id");
		t.integer("user_id").notNull();
		t.string("visibility").notNull();
	});
	await hostTable("proxy_host", (t) => {
		t.integer("npmpro_mtls_certificate_id").notNull().defaultTo(0);
		t.integer("access_list_id").notNull().defaultTo(0);
	});
	await hostTable("redirection_host");
	await hostTable("dead_host");
	await knex.schema.createTable("stream", (t) => {
		t.increments("id");
		t.integer("owner_user_id").notNull().defaultTo(1);
		t.string("incoming_port").notNull().defaultTo("");
		t.integer("enabled").notNull().defaultTo(1);
		t.integer("npmpro_nginx_online").notNull().defaultTo(1);
		t.text("npmpro_nginx_err").notNull().defaultTo("");
		t.integer("certificate_id").notNull().defaultTo(0);
		t.json("meta").notNull().defaultTo("{}");
	});
	await knex.schema.createTable("npmpro_location", (t) => {
		t.increments("id");
		t.integer("proxy_host_id").notNull();
		t.text("path").notNull();
	});
	await knex.schema.createTable("npmpro_proxy_host_access_list", (t) => {
		t.integer("proxy_host_id").notNull();
		t.integer("location_id").notNull().defaultTo(0);
		t.integer("access_list_id").notNull();
		t.primary(["proxy_host_id", "location_id", "access_list_id"]);
	});
	await knex.schema.createTable("certificate", (t) => {
		t.increments("id");
		t.integer("owner_user_id").notNull().defaultTo(1);
		t.string("provider").notNull();
		t.string("nice_name").notNull().defaultTo("");
		t.json("domain_names").notNull().defaultTo("[]");
		t.json("meta").notNull().defaultTo("{}");
		t.integer("npmpro_dns_credential_id").nullable();
	});
	await knex.schema.createTable("access_list", (t) => {
		t.increments("id");
		t.integer("owner_user_id").notNull().defaultTo(1);
		t.string("name").notNull();
		t.json("meta").notNull().defaultTo("{}");
	});
	for (const table of ["access_list_auth", "access_list_client"]) {
		await knex.schema.createTable(table, (t) => {
			t.increments("id");
			t.integer("access_list_id").notNull();
			t.string("value").notNull().defaultTo("");
			t.string("password").notNull().defaultTo("");
			t.json("meta").notNull().defaultTo("{}");
		});
	}
	await knex.schema.createTable("npmpro_dns_credential", (t) => {
		t.increments("id");
		t.integer("owner_user_id").notNull().defaultTo(1);
		t.string("name").notNull();
		t.text("values").notNull();
	});
	await knex.schema.createTable("setting", (t) => {
		t.string("id").primary();
		t.string("name").notNull().defaultTo("");
		t.json("meta").notNull().defaultTo("{}");
	});
	await knex("user").insert({ id: 1, email: "admin@example.com", name: "Admin", roles: '["admin"]' });
	await knex("auth").insert({ id: 1, user_id: 1, type: "password", secret: "admin-hash", meta: "{}" });
	await knex("user_permission").insert({ id: 1, user_id: 1, visibility: "all" });
};

/**
 * A service on a fresh database and folders with spies for everything outside
 *
 * @param {Object}   [options]
 * @param {Function} [options.test]         the fake nginx -t, gets the call number
 * @param {Function} [options.pause]        the fake renewal pause
 * @param {string[]} [options.migrations]   the instance's completed migrations
 * @param {string}   [options.root]         shares the folders of another setup
 * @param {Function} [options.exclusive]    the runtime queue
 * @param {Function} [options.regenerated]  (knex, call) => Promise, runs in the fake host regeneration
 * @param {Object}   [options.failedGroups] what the fake applyAllRuntime reports
 * @param {number}   [options.maxUpload]
 */
const setup = async ({
	test = async () => {},
	pause = async () => {},
	migrations = MIGRATIONS,
	root,
	exclusive,
	regenerated = async () => {},
	failedGroups = {},
	maxUpload,
} = {}) => {
	const base = root ?? (await mkdtemp(path.join(os.tmpdir(), "backup-orchestrator-")));
	const dataDir = path.join(base, "data");
	const backupsDir = path.join(base, "backups");
	await mkdir(dataDir, { recursive: true });
	await mkdir(backupsDir, { recursive: true, mode: 0o700 });
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	await createSchema(knex);
	const clock = { offset: 0, now: () => Date.now() + clock.offset };
	const calls = { test: 0, reload: 0, pause: 0, resume: 0, regenerate: 0, applyAll: 0, reloaded: [], audit: [] };
	let paused = false;
	const store = createBackupStore({ dir: backupsDir, clock, tokenTtlMs: 60_000 });
	const service = createBackupService({
		knex,
		box,
		dataDir,
		store,
		dbVersion: () => Promise.resolve(DB_VERSION),
		dbMigrations: () => Promise.resolve(migrations),
		npmproVersion: "1.0.0",
		instanceKey: async () => Buffer.alloc(32, 7),
		audit: (_access, entry) => {
			calls.audit.push(entry);
			return Promise.resolve();
		},
		nginx: {
			test: async () => {
				calls.test++;
				await test(calls.test);
			},
			reload: () => {
				calls.reload++;
				return Promise.resolve();
			},
		},
		renewals: {
			pause: async () => {
				calls.pause++;
				paused = true;
				await pause();
			},
			resume: () => {
				calls.resume++;
				paused = false;
			},
		},
		regenerate: {
			loadEnabledHosts: async () => [],
			regenerateAllHostsNow: () => {
				calls.regenerate++;
				return regenerated(knex, calls.regenerate);
			},
			rebuildAccessListFiles: async () => {},
			regenerateDefaultSite: async () => {},
		},
		runtime: {
			loadRuntimeConfig: async () => {},
			applyAllRuntime: () => {
				calls.applyAll++;
				return Promise.resolve(failedGroups);
			},
		},
		reloadSettings: {
			oidc: () => {
				calls.reloaded.push("oidc");
			},
			monitoring: () => {
				calls.reloaded.push("monitoring");
				return Promise.resolve();
			},
		},
		...(exclusive ? { exclusive } : {}),
		...(maxUpload ? { maxUpload } : {}),
		hostname: "test-host",
		clock,
		log: silent,
	});
	const cleanup = async () => {
		await knex.destroy();
		if (!root) await rm(base, { recursive: true, force: true });
	};
	return { base, dataDir, backupsDir, knex, clock, calls, store, service, isPaused: () => paused, cleanup };
};

const hostIds = async (knex) => (await knex("proxy_host").orderBy("id").pluck("id")).map(Number);

const customFile = (dataDir) => path.join(dataDir, "custom_nginx", "http.conf");

// the instance as the backup is made: proxy host #1 and a custom nginx file; afterwards it changes to host #2 and
// another file content
const backupThenChange = async (ctx, { secrets = true, types = ["proxy_hosts", "custom_nginx"] } = {}) => {
	await ctx.knex("proxy_host").insert({ id: 1, domain_names: '["one.example.com"]' });
	await mkdir(path.join(ctx.dataDir, "custom_nginx"), { recursive: true });
	await writeFile(customFile(ctx.dataDir), "# from the backup\n");
	const { entry } = await ctx.service.create(access, {
		types,
		secrets,
		passphrase: secrets ? PASSPHRASE : undefined,
		keep: true,
	});
	await ctx.knex("proxy_host").del();
	await ctx.knex("proxy_host").insert({ id: 2, domain_names: '["two.example.com"]' });
	await writeFile(customFile(ctx.dataDir), "# the instance\n");
	return entry;
};

const hasCode = (code) => (error) => error.code === code;

it("restores proxy hosts and custom nginx files from a backup with secrets", TIMEOUT, async () => {
	const ctx = await setup();
	try {
		const entry = await backupThenChange(ctx);
		assert.equal(entry.summary.secrets, true);
		assert.equal(entry.encrypted, true);
		const inspected = await ctx.service.inspect(access, entry.name, { passphrase: PASSPHRASE });
		assert.deepEqual(inspected.manifest.types, ["proxy_hosts", "custom_nginx"]);
		assert.equal(inspected.manifest.files, undefined);
		assert.deepEqual(inspected.preview.missingSecrets, []);
		const result = await ctx.service.restore(access, inspected.token, { types: ["proxy_hosts", "custom_nginx"] });
		assert.deepEqual(result.counts, { proxy_hosts: 1 });
		assert.equal(result.restartNeeded, false);
		assert.deepEqual(await hostIds(ctx.knex), [1]);
		assert.equal(await readFile(customFile(ctx.dataDir), "utf8"), "# from the backup\n");
		assert.equal(ctx.calls.test, 1);
		assert.equal(ctx.calls.reload, 1);
		assert.equal(ctx.calls.regenerate, 1);
		assert.equal(ctx.calls.applyAll, 1);
		assert.deepEqual([ctx.calls.pause, ctx.calls.resume, ctx.isPaused()], [1, 1, false]);
		const auto = await readdir(path.join(ctx.backupsDir, "auto"));
		assert.equal(auto.length, 1);
		assert.match(auto[0], AUTO_NAME);
		assert.deepEqual(
			ctx.calls.audit.map((item) => item.action),
			["created", "restored"],
		);
		const restored = ctx.calls.audit[1];
		assert.equal(restored.object_type, "backup");
		assert.equal(restored.meta.name, entry.name);
		assert.equal(JSON.stringify(ctx.calls.audit).includes(PASSPHRASE), false);
		// the stage is gone with the token
		await assert.rejects(
			ctx.service.check(access, inspected.token, { types: ["proxy_hosts"] }),
			hasCode("token-expired"),
		);
		assert.deepEqual(
			(await readdir(ctx.backupsDir)).filter((name) => name.startsWith(".")),
			[],
		);
	} finally {
		await ctx.cleanup();
	}
});

it("rolls back to the instance's state when nginx rejects the restored configuration", TIMEOUT, async () => {
	const ctx = await setup({
		test: (call) => {
			if (call === 1) throw new Error("nginx: [emerg] unknown directive in custom_nginx/http.conf");
		},
	});
	try {
		const entry = await backupThenChange(ctx);
		const { token } = await ctx.service.inspect(access, entry.name, { passphrase: PASSPHRASE });
		await assert.rejects(
			ctx.service.restore(access, token, { types: ["proxy_hosts", "custom_nginx"] }),
			(error) => {
				assert.equal(error.code, "nginx-failed");
				assert.match(error.message, UNKNOWN_DIRECTIVE);
				return true;
			},
		);
		assert.deepEqual(await hostIds(ctx.knex), [2]);
		assert.equal(await readFile(customFile(ctx.dataDir), "utf8"), "# the instance\n");
		assert.equal(ctx.calls.test, 2);
		assert.equal(ctx.calls.reload, 1);
		assert.deepEqual([ctx.calls.pause, ctx.calls.resume, ctx.isPaused()], [1, 1, false]);
		assert.deepEqual(
			ctx.calls.audit.map((item) => item.action),
			["created"],
		);
	} finally {
		await ctx.cleanup();
	}
});

it("refuses a second restore while one runs", TIMEOUT, async () => {
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	let started;
	const running = new Promise((resolve) => {
		started = resolve;
	});
	const ctx = await setup({
		pause: () => {
			started();
			return held;
		},
	});
	try {
		const entry = await backupThenChange(ctx, { secrets: false });
		const { token } = await ctx.service.inspect(access, entry.name, {});
		const first = ctx.service.restore(access, token, { types: ["proxy_hosts"] });
		await running;
		await assert.rejects(ctx.service.restore(access, token, { types: ["proxy_hosts"] }), (error) => {
			assert.equal(error.code, "busy");
			assert.equal(error.status, 409);
			return true;
		});
		await assert.rejects(ctx.service.inspect(access, entry.name, {}), hasCode("busy"));
		release();
		await first;
		assert.deepEqual(await hostIds(ctx.knex), [1]);
	} finally {
		release();
		await ctx.cleanup();
	}
});

it("refuses an expired restore token", TIMEOUT, async () => {
	const ctx = await setup();
	try {
		const entry = await backupThenChange(ctx, { secrets: false });
		const { token } = await ctx.service.inspect(access, entry.name, {});
		ctx.clock.offset = 61_000;
		await assert.rejects(ctx.service.restore(access, token, { types: ["proxy_hosts"] }), hasCode("token-expired"));
		assert.deepEqual(await hostIds(ctx.knex), [2]);
		assert.equal(ctx.calls.pause, 0);
	} finally {
		await ctx.cleanup();
	}
});

it("refuses at inspect a backup of a newer database or a newer format", TIMEOUT, async () => {
	const newer = await setup({ migrations: [...MIGRATIONS, "20261101000000_later.js"] });
	const ctx = await setup({ root: newer.base });
	try {
		const entry = await backupThenChange(newer, { secrets: false });
		await assert.rejects(ctx.service.inspect(access, entry.name, {}), hasCode("newer-database"));

		const write = (name, headerSummary) =>
			writeBackupFile({
				source: Readable.from([Buffer.from("not read")]),
				file: path.join(ctx.backupsDir, name),
				mode: "none",
				summary: headerSummary,
			});
		const summary = { types: ["proxy_hosts"], counts: {}, created_at: new Date().toISOString(), secrets: false };
		await write("npmpro-backup-other-20261026-120000.npmpro", { ...summary, format: 2 });
		await assert.rejects(
			ctx.service.inspect(access, "npmpro-backup-other-20261026-120000.npmpro", {}),
			hasCode("newer-format"),
		);
		await write("npmpro-backup-other-20261026-120001.npmpro", { ...summary, format: 1, types: ["traffic"] });
		await assert.rejects(
			ctx.service.inspect(access, "npmpro-backup-other-20261026-120001.npmpro", {}),
			hasCode("invalid-archive"),
		);
		// nothing staged is left behind
		assert.deepEqual(
			(await readdir(ctx.backupsDir)).filter((name) => name.startsWith(".")),
			[],
		);
	} finally {
		await ctx.cleanup();
		await newer.cleanup();
		await rm(newer.base, { recursive: true, force: true });
	}
});

it("lists the types left out of a backup without secrets in the preview", TIMEOUT, async () => {
	const ctx = await setup();
	try {
		const entry = await backupThenChange(ctx, { secrets: false, types: ["users", "proxy_hosts"] });
		assert.equal(entry.encrypted, false);
		const { preview, token } = await ctx.service.inspect(access, entry.name, {});
		assert.deepEqual(preview.missingSecrets, ["users"]);
		assert.deepEqual((await ctx.service.check(access, token, { types: ["proxy_hosts"] })).missingSecrets, []);
		await assert.rejects(ctx.service.check(access, token, { types: ["custom_nginx"] }), hasCode("invalid-types"));
		ctx.service.cancel(access, token);
		await assert.rejects(ctx.service.check(access, token, { types: ["users"] }), hasCode("token-expired"));
	} finally {
		await ctx.cleanup();
	}
});

const certificateFiles = async (dataDir, id) => {
	const archive = path.join(dataDir, "tls/certbot/archive", `npm-${id}`);
	await mkdir(archive, { recursive: true });
	for (const name of ["cert1.pem", "chain1.pem", "fullchain1.pem", "privkey1.pem"]) {
		await writeFile(path.join(archive, name), `${name} of ${id}\n`);
	}
	const live = path.join(dataDir, "tls/certbot/live", `npm-${id}`);
	await mkdir(live, { recursive: true });
	for (const name of ["cert", "chain", "fullchain", "privkey"]) {
		await symlink(`../../archive/npm-${id}/${name}1.pem`, path.join(live, `${name}.pem`));
	}
};

it("links the instance's certificates again when a certificate restore is rolled back", TIMEOUT, async () => {
	const ctx = await setup({
		test: (call) => {
			if (call === 1) throw new Error("nginx: [emerg] cannot load certificate");
		},
	});
	try {
		await ctx.knex("certificate").insert({ id: 5, provider: "letsencrypt", nice_name: "backup" });
		await certificateFiles(ctx.dataDir, 5);
		const { entry } = await ctx.service.create(access, {
			types: ["certificates"],
			secrets: true,
			passphrase: PASSPHRASE,
			keep: true,
		});
		await ctx.knex("certificate").del();
		await rm(path.join(ctx.dataDir, "tls"), { recursive: true });
		await ctx.knex("certificate").insert({ id: 3, provider: "letsencrypt", nice_name: "instance" });
		await certificateFiles(ctx.dataDir, 3);

		const { token } = await ctx.service.inspect(access, entry.name, { passphrase: PASSPHRASE });
		await assert.rejects(ctx.service.restore(access, token, { types: ["certificates"] }), hasCode("nginx-failed"));
		assert.deepEqual((await ctx.knex("certificate").pluck("id")).map(Number), [3]);
		const live = path.join(ctx.dataDir, "tls/certbot/live");
		assert.deepEqual(await readdir(live), ["npm-3"]);
		assert.equal(readlinkSync(path.join(live, "npm-3", "cert.pem")), "../../archive/npm-3/cert1.pem");
		assert.equal(await readFile(path.join(live, "npm-3", "cert.pem"), "utf8"), "cert1.pem of 3\n");
		assert.equal(existsSync(path.join(ctx.dataDir, "tls/certbot/archive/npm-5")), false);
	} finally {
		await ctx.cleanup();
	}
});

it("checks the passphrase length, the chosen types and the counts", TIMEOUT, async () => {
	const ctx = await setup();
	try {
		await assert.rejects(
			ctx.service.create(access, { types: ["proxy_hosts"], secrets: true, passphrase: "short", keep: true }),
			hasCode("weak-passphrase"),
		);
		await assert.rejects(
			ctx.service.create(access, { types: ["traffic"], secrets: false, keep: true }),
			hasCode("invalid-types"),
		);
		await ctx.knex("certificate").insert([
			{ id: 1, provider: "letsencrypt" },
			{ id: 2, provider: "mtls" },
		]);
		await mkdir(path.join(ctx.dataDir, "custom_nginx"), { recursive: true });
		await writeFile(customFile(ctx.dataDir), "#\n");
		const { counts, certificateKinds } = await ctx.service.types(access);
		assert.equal(counts.certificates, 2);
		assert.equal(counts.users, 1);
		assert.equal(counts.custom_nginx, 1);
		assert.deepEqual(certificateKinds, { letsencrypt: 1, other: 0, mtls: 1 });
		const denied = {
			canAdmin: () => {
				throw Object.assign(new Error("Permission Denied"), { name: "PermissionError" });
			},
			token: { getUserId: () => 2 },
		};
		await assert.rejects(ctx.service.list(denied), { name: "PermissionError" });
	} finally {
		await ctx.cleanup();
	}
});

it("reports a wrong passphrase or a changed byte at inspect as such, not as an invalid archive", TIMEOUT, async () => {
	const ctx = await setup();
	try {
		const entry = await backupThenChange(ctx);
		await assert.rejects(
			ctx.service.inspect(access, entry.name, { passphrase: "a wrong passphrase" }),
			hasCode("wrong-passphrase"),
		);
		const file = path.join(ctx.backupsDir, entry.name);
		const bytes = await readFile(file);
		bytes[bytes.length - 40] ^= 1;
		await writeFile(file, bytes);
		await assert.rejects(
			ctx.service.inspect(access, entry.name, { passphrase: PASSPHRASE }),
			hasCode("wrong-passphrase"),
		);
		assert.deepEqual(
			(await readdir(ctx.backupsDir)).filter((name) => name.startsWith(".restore-")),
			[],
		);
	} finally {
		await ctx.cleanup();
	}
});

it("stores a download that is not kept as a pending file", TIMEOUT, async () => {
	const ctx = await setup();
	try {
		await ctx.knex("proxy_host").insert({ id: 1 });
		const created = await ctx.service.create(access, { types: ["proxy_hosts"], secrets: false, keep: false });
		assert.match(created.name, PLAIN_NAME);
		const file = ctx.service.takePending(access, created.pending);
		assert.ok(existsSync(file));
		assert.deepEqual(await ctx.service.list(access), []);
	} finally {
		await ctx.cleanup();
	}
});

it("compares the migrations as sets of names", () => {
	assert.deepEqual(unknownMigrations(["b.js", "a.js"], ["a.js", "b.js"]), []);
	assert.deepEqual(unknownMigrations(["a.js"], ["a.js", "b.js"]), []);
	// a malformed old name sorts after every new one: only the names count
	assert.deepEqual(unknownMigrations(["20261402145603_old.js", "20261101000000_new.js"], ["20261402145603_old.js"]), [
		"20261101000000_new.js",
	]);
	assert.deepEqual(unknownMigrations(undefined, []), []);
	assert.throws(() => unknownMigrations("a.js", []), hasCode("invalid-archive"));
});

it("finishes a restore while a running renewal waits on the runtime queue", { timeout: 20_000 }, async () => {
	// the runtime queue, as runtimeExclusive; a running renewal queues its stapling recovery there before it ends
	const queue = createSerializer();
	let renewalRan = false;
	const ctx = await setup({
		exclusive: queue,
		pause: () =>
			queue(() => {
				renewalRan = true;
			}),
	});
	try {
		const entry = await backupThenChange(ctx, { secrets: false });
		const { token } = await ctx.service.inspect(access, entry.name, {});
		const result = await ctx.service.restore(access, token, { types: ["proxy_hosts"] });
		assert.equal(renewalRan, true);
		assert.deepEqual(result.counts, { proxy_hosts: 1 });
		assert.deepEqual([ctx.calls.pause, ctx.calls.resume, ctx.isPaused()], [1, 1, false]);
	} finally {
		await ctx.cleanup();
	}
});

it("accepts a backup whose migrations the instance has all run", TIMEOUT, async () => {
	const older = await setup({ migrations: [MIGRATIONS[0]] });
	const ctx = await setup({ root: older.base });
	try {
		const entry = await backupThenChange(older, { secrets: false });
		const { manifest, token } = await ctx.service.inspect(access, entry.name, {});
		assert.deepEqual(manifest.db_migrations, [MIGRATIONS[0]]);
		ctx.service.cancel(access, token);
		const same = await older.service.inspect(access, entry.name, {});
		assert.equal(typeof same.token, "string");
	} finally {
		await ctx.cleanup();
		await older.cleanup();
		await rm(older.base, { recursive: true, force: true });
	}
});

it("reports hosts nginx rejected in the regeneration without rolling back", TIMEOUT, async () => {
	const ctx = await setup({
		regenerated: (knex) =>
			knex("proxy_host")
				.where({ id: 1 })
				.update({ npmpro_nginx_online: 0, npmpro_nginx_err: "x".repeat(600) }),
	});
	try {
		const entry = await backupThenChange(ctx, { secrets: false });
		const { token } = await ctx.service.inspect(access, entry.name, {});
		const result = await ctx.service.restore(access, token, { types: ["proxy_hosts"] });
		assert.deepEqual(result.offlineHosts, [
			{ type: "proxy_host", id: 1, domain: "one.example.com", error: "x".repeat(500) },
		]);
		assert.deepEqual(await hostIds(ctx.knex), [1]);
		assert.deepEqual([ctx.calls.test, ctx.calls.reload], [1, 1]);
		assert.equal(ctx.calls.audit.at(-1).meta.offline_hosts, 1);
	} finally {
		await ctx.cleanup();
	}
});

it(
	"reports settings that need a restart, failed runtime groups and reloads the restored settings",
	TIMEOUT,
	async () => {
		const ctx = await setup({ failedGroups: { network: new Error("could not fetch the Cloudflare ranges") } });
		try {
			await ctx.knex("setting").insert([
				{ id: "logs", meta: JSON.stringify({ goaccess: true }) },
				{ id: "oidc", meta: JSON.stringify({ enabled: false }) },
				{ id: "monitoring", meta: "{}" },
				{ id: "geoip", meta: "{}" },
			]);
			const types = ["settings_runtime", "settings_oidc", "settings_monitoring"];
			const { entry } = await ctx.service.create(access, { types, secrets: false, keep: true });
			const { token } = await ctx.service.inspect(access, entry.name, {});
			const result = await ctx.service.restore(access, token, { types });
			assert.equal(result.restartNeeded, true);
			assert.deepEqual(result.runtimeFailed, ["network"]);
			assert.deepEqual(ctx.calls.reloaded, ["oidc", "monitoring"]);
			assert.deepEqual(result.offlineHosts, []);
		} finally {
			await ctx.cleanup();
		}
	},
);

it("names the automatic backup when the rollback fails too", TIMEOUT, async () => {
	const ctx = await setup({
		test: () => {
			throw new Error("nginx: [emerg] broken");
		},
	});
	try {
		const entry = await backupThenChange(ctx, { secrets: false });
		const { token } = await ctx.service.inspect(access, entry.name, {});
		await assert.rejects(ctx.service.restore(access, token, { types: ["proxy_hosts"] }), (error) => {
			assert.equal(error.code, "rollback-failed");
			assert.equal(error.status, 500);
			assert.match(error.message, AUTO_IN_MESSAGE);
			return true;
		});
		assert.deepEqual([ctx.calls.pause, ctx.calls.resume, ctx.isPaused()], [1, 1, false]);
	} finally {
		await ctx.cleanup();
	}
});

it("rolls back an internal failure without showing its message", TIMEOUT, async () => {
	const ctx = await setup({
		regenerated: (_knex, call) =>
			call === 1 ? Promise.reject(new Error("connection to db.internal:5432 failed")) : Promise.resolve(),
	});
	try {
		const entry = await backupThenChange(ctx, { secrets: false });
		const { token } = await ctx.service.inspect(access, entry.name, {});
		await assert.rejects(
			ctx.service.restore(access, token, { types: ["proxy_hosts", "custom_nginx"] }),
			(error) => {
				assert.equal(error.code, "restore-failed");
				assert.equal(error.message.includes("db.internal"), false);
				return true;
			},
		);
		assert.deepEqual(await hostIds(ctx.knex), [2]);
		assert.equal(await readFile(customFile(ctx.dataDir), "utf8"), "# the instance\n");
		assert.deepEqual([ctx.calls.test, ctx.calls.reload], [1, 1]);
	} finally {
		await ctx.cleanup();
	}
});

const dotFiles = async (dir) => (await readdir(dir)).filter((name) => name.startsWith("."));

it("stores uploads under their own name and refuses too large or foreign files", TIMEOUT, async () => {
	const ctx = await setup({ maxUpload: 64 * 1024 });
	try {
		await ctx.knex("proxy_host").insert({ id: 1 });
		const { entry } = await ctx.service.create(access, { types: ["proxy_hosts"], secrets: false, keep: true });
		const bytes = await readFile(path.join(ctx.backupsDir, entry.name));
		await ctx.service.remove(access, entry.name);

		const stored = await ctx.service.upload(access, Readable.from([bytes]), { name: entry.name });
		assert.equal(stored.name, entry.name);
		assert.deepEqual(stored.summary.types, ["proxy_hosts"]);
		const again = await ctx.service.upload(access, Readable.from([bytes]), { name: entry.name });
		assert.equal(again.name, entry.name.replace(".npmpro", "-2.npmpro"));
		const renamed = await ctx.service.upload(access, Readable.from([bytes]), { name: "../backup.npmpro" });
		assert.match(renamed.name, UPLOAD_NAME);
		assert.deepEqual(
			ctx.calls.audit.filter((item) => item.action === "uploaded").map((item) => item.meta.name),
			[stored.name, again.name, renamed.name],
		);

		await assert.rejects(
			ctx.service.upload(access, Readable.from([Buffer.alloc(100 * 1024)]), { name: entry.name }),
			(error) => {
				assert.equal(error.code, "too-large");
				assert.equal(error.status, 413);
				return true;
			},
		);
		await assert.rejects(
			ctx.service.upload(access, Readable.from([Buffer.from("not a backup at all")]), {}),
			hasCode("not-a-backup"),
		);
		const autoNamed = await ctx.service.upload(access, Readable.from([bytes]), {
			name: "npmpro-backup-x-20261026-101500-auto.npmpro",
		});
		assert.equal(autoNamed.name, "npmpro-backup-x-20261026-101500.npmpro");
		assert.equal(autoNamed.auto, false);
		assert.ok(existsSync(path.join(ctx.backupsDir, autoNamed.name)));
		assert.deepEqual(await dotFiles(ctx.backupsDir), []);
		assert.equal((await ctx.service.list(access)).length, 4);
	} finally {
		await ctx.cleanup();
	}
});

it("reports hosts of types that were not restored when the regeneration took them offline", TIMEOUT, async () => {
	const ctx = await setup({
		regenerated: (knex) =>
			knex("proxy_host").where({ id: 2 }).update({ npmpro_nginx_online: 0, npmpro_nginx_err: "no certificate" }),
	});
	try {
		await ctx.knex("access_list").insert({ id: 4, name: "office" });
		const { entry } = await ctx.service.create(access, { types: ["access_lists"], secrets: false, keep: true });
		await ctx.knex("proxy_host").insert({ id: 2, domain_names: '["two.example.com"]' });
		const { token } = await ctx.service.inspect(access, entry.name, {});
		const result = await ctx.service.restore(access, token, { types: ["access_lists"] });
		assert.deepEqual(result.offlineHosts, [
			{ type: "proxy_host", id: 2, domain: "two.example.com", error: "no certificate" },
		]);
		assert.equal(ctx.calls.audit.at(-1).meta.offline_hosts, 1);
	} finally {
		await ctx.cleanup();
	}
});

it("finishes a restore when the offline hosts cannot be read", TIMEOUT, async () => {
	const ctx = await setup({ regenerated: (knex) => knex.schema.dropTable("stream") });
	try {
		const entry = await backupThenChange(ctx, { secrets: false });
		const { token } = await ctx.service.inspect(access, entry.name, {});
		const result = await ctx.service.restore(access, token, { types: ["proxy_hosts"] });
		assert.deepEqual(result.offlineHosts, []);
		assert.deepEqual(await hostIds(ctx.knex), [1]);
		assert.equal(ctx.calls.audit.at(-1).action, "restored");
	} finally {
		await ctx.cleanup();
	}
});
