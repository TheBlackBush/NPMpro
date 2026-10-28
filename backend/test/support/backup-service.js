import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import knexFactory from "knex";
import { createBackupService } from "../../internal/backup.js";
import { createBackupStore } from "../../lib/backup/store.js";
import { createSchema } from "./backup-schema.js";

// the backup service on a fresh database and folders, with fakes for everything outside it

const DB_VERSION = "20261026000000";
const MIGRATIONS = ["20180618015850_initial.js", "20261026000000_base.js"];
const box = {
	encrypt: (value) => `v1:${JSON.stringify(value)}`,
	decrypt: (value) => JSON.parse(value.slice(3)),
};
const silent = { info: () => {}, warn: () => {}, error: () => {} };

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
 * @param {number}   [options.maxImport]    bytes, the page import limit
 * @param {Buffer}   [options.instanceKey]
 * @param {string}   [options.hostname]
 * @param {Function} [options.audited]      (entry) => Promise, runs in the fake audit log write
 */
const setup = async ({
	test = async () => {},
	pause = async () => {},
	migrations = MIGRATIONS,
	root,
	instanceKey = Buffer.alloc(32, 7),
	hostname = "npmpro",
	exclusive,
	regenerated = async () => {},
	failedGroups = {},
	maxUpload,
	maxImport,
	audited = async () => {},
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
	const calls = {
		test: 0,
		reload: 0,
		pause: 0,
		resume: 0,
		regenerate: 0,
		applyAll: 0,
		reloaded: [],
		audit: [],
		credentials: [],
		removedCredentials: [],
	};
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
		instanceKey: async () => instanceKey,
		audit: (_access, entry) => {
			calls.audit.push(entry);
			return audited(entry);
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
		dnsCredentials: {
			write: (certificate) => {
				calls.credentials.push({
					id: Number(certificate.id),
					credentialId: Number(certificate.npmpro_dns_credential_id),
				});
				return Promise.resolve();
			},
			remove: (id) => {
				calls.removedCredentials.push(Number(id));
				return Promise.resolve();
			},
		},
		...(exclusive ? { exclusive } : {}),
		...(maxUpload ? { maxUpload } : {}),
		...(maxImport ? { maxImport } : {}),
		hostname,
		clock,
		log: silent,
	});
	const cleanup = async () => {
		await knex.destroy();
		if (!root) await rm(base, { recursive: true, force: true });
	};
	return { base, dataDir, backupsDir, knex, clock, calls, store, service, isPaused: () => paused, cleanup };
};

export { box, DB_VERSION, MIGRATIONS, setup };
