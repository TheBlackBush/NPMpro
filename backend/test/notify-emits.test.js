import assert from "node:assert/strict";
import { cp } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { global as globalLogger, ssl as logger } from "../logger.js";
import { startApi } from "./support/api.js";
import {
	acmeDirectory,
	certbotFails,
	certbotSucceeds,
	makeCertificate,
	makeExpiredCertificate,
} from "./support/certbot.js";

const CERTS = "/nginx/certificates";
const ACME = "https://acme.example.test/directory";
const STATE = "npmpro_notification_state";
const DAY = 86_400_000;
const TOKEN = "cf-token-SECRET-1234567890";
const MASKED = /Challenge failed with token \*\*\* for the zone/u;
const GENERIC = /^The renewal failed/u;
const WENT_WRONG = /Renewal went wrong/u;
const KEY_PATH = /private_key|\/accounts\//u;
const sql = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

let api;
let admin;
let pair;
let expired;
let internalCertificate;
let notify;
let stateStore;
let seen;
let logged;

const requested = async (name) => {
	const made = await admin.post(CERTS, { provider: "letsencrypt", domain_names: [name] });
	if (made.status !== 201) throw new Error(made.text);
	return made.body;
};
const live = (id) => path.join(api.root, `data/tls/certbot/live/npm-${id}/fullchain.pem`);
const stale = (id, on = "2000-01-01 00:00:00") => api.db("certificate").where({ id }).update({ expires_on: on });
const eventsOf = (type, id) => seen.filter((one) => one.type === type && (id === undefined || one.data.id === id));
const rowsOf = () => api.db("certificate").orderBy("id");
const keepLogs = () => {
	const loggers = [logger, globalLogger];
	const originals = loggers.map((one) => ({ ...one }));
	const capture =
		() =>
		(...parts) =>
			logged.push(parts.map(String).join(" "));
	for (const one of loggers) for (const level of ["debug", "info", "warn", "error"]) one[level] = capture();
	return () => {
		for (const [at, one] of loggers.entries()) Object.assign(one, originals[at]);
	};
};
const dnsCertificate = async (name) => {
	const made = await admin.post("/nginx/dns-credentials", {
		name: `credential ${name}`,
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: TOKEN }],
	});
	if (made.status !== 201) throw new Error(made.text);
	const certificate = await requested(name);
	await api.db("certificate").where({ id: certificate.id }).update({
		npmpro_dns_challenge: 1,
		npmpro_dns_provider: "cloudflare",
		npmpro_dns_credential_id: made.body.id,
	});
	await stale(certificate.id, "2020-06-01 00:00:00");
	await cp(expired.certificate, live(certificate.id));
	return { certificate, credentialId: made.body.id };
};
const run = async () => {
	internalCertificate.intervalProcessing = false;
	return await internalCertificate.processExpiringHosts();
};

before(async () => {
	api = await startApi({ env: { ACME_SERVER: ACME, NPMPRO_TEST_OUTBOUND: "mock" } });
	api.outside.dns.set("acme.example.test", "192.0.2.50");
	acmeDirectory(api, ACME);
	admin = await api.admin();
	pair = await makeCertificate(path.join(api.root, "fake"), "emit.example.com");
	expired = await makeExpiredCertificate(path.join(api.root, "fake"), "stuck.example.com");
	internalCertificate = (await import("../internal/certificate.js")).default;
	({ notify, stateStore } = await import("../internal/notify.js"));
	notify.registerChannel({
		id: "fake",
		accepts: () => true,
		targets: (envelope) => {
			seen.push(envelope);
			return Promise.resolve([]);
		},
	});
});
beforeEach(async () => {
	seen = [];
	logged = [];
	await api.db(STATE).delete();
	await certbotSucceeds(api, pair);
});
after(() => api?.stop());

describe("certificate emit points", () => {
	it("a run with one renewed and one stuck certificate sends one renewed and one renewal_failed, then resolves", async () => {
		const renewed = await requested("renewed.example.com");
		const stuck = await requested("stuck.example.com");
		const healthy = await requested("healthy.example.com");
		await stale(renewed.id);
		await stale(stuck.id, "2020-06-01 00:00:00");
		await cp(expired.certificate, live(stuck.id));
		await certbotFails(api, "Renewal went wrong, see /data/tls/certbot/accounts/acme/abc/private_key.json");
		seen = [];
		assert.equal(await run(), undefined);

		assert.equal(eventsOf("certificate.renewed").length, 1);
		assert.equal(eventsOf("certificate.renewed")[0].data.id, renewed.id);
		const failed = eventsOf("certificate.renewal_failed");
		assert.equal(failed.length, 1);
		assert.equal(failed[0].data.id, stuck.id);
		assert.match(failed[0].data.error, WENT_WRONG);
		assert.doesNotMatch(failed[0].data.error, KEY_PATH);
		assert.equal(seen.filter((one) => one.data.id === healthy.id).length, 0);

		// the next run: the stuck certificate is renewed
		await certbotSucceeds(api, pair);
		await cp(pair.certificate, live(stuck.id));
		seen = [];
		await run();
		assert.equal(eventsOf("certificate.renewal_failed.resolved", stuck.id).length, 1);
		assert.equal(eventsOf("certificate.renewed", stuck.id).length, 1);
		assert.equal(eventsOf("certificate.renewal_failed").length, 0);
	});

	it("the expiry check sends soon once, nothing after a restart, and a delete clears the states", async () => {
		const [id] = await api.db("certificate").insert({
			owner_user_id: 1,
			created_on: "2026-01-01 00:00:00",
			modified_on: "2026-01-01 00:00:00",
			provider: "other",
			nice_name: "custom",
			domain_names: JSON.stringify(["custom.example.com"]),
			expires_on: sql(Date.now() + 3 * DAY),
			meta: "{}",
		});
		await internalCertificate.checkCertificateExpiry();
		const sent = eventsOf("certificate.expiring", id);
		assert.equal(sent.length, 1);
		assert.equal(sent[0].data.state, "soon");
		assert.ok([2, 3].includes(sent[0].data.days_left));

		await internalCertificate.checkCertificateExpiry();
		assert.equal(eventsOf("certificate.expiring", id).length, 1);
		assert.equal((await api.db(STATE).where({ event: "certificate.expiring", object_id: String(id) })).length, 1);

		assert.equal((await admin.delete(`${CERTS}/${id}`)).status, 200);
		assert.equal((await api.db(STATE).where({ object_id: String(id) })).length, 0);
	});

	it("a credential value in the certbot text reaches neither the event nor a log line", async () => {
		const { certificate } = await dnsCertificate("secret.example.com");
		const other = await requested("other.example.com");
		await stale(other.id, "2020-06-01 00:00:00");
		await cp(expired.certificate, live(other.id));
		await certbotFails(api, `Challenge failed with token ${TOKEN} for the zone`);
		seen = [];
		const restore = keepLogs();
		try {
			await run();
		} finally {
			restore();
		}
		// the credential of one certificate is scrubbed from the text every stuck certificate gets
		for (const id of [certificate.id, other.id]) {
			const [sent] = eventsOf("certificate.renewal_failed", id);
			assert.match(sent.data.error, MASKED);
		}
		assert.ok(logged.some((line) => line.includes("Certbot completed with errors")));
		assert.equal(JSON.stringify(seen).includes(TOKEN), false);
		assert.equal(
			logged.some((line) => line.includes(TOKEN)),
			false,
		);
	});

	it("a credential that cannot be opened gives a generic error text, never the certbot text", async () => {
		const { certificate, credentialId } = await dnsCertificate("broken.example.com");
		await api.db("npmpro_dns_credential").where({ id: credentialId }).update({ values: "v1:broken" });
		await certbotFails(api, `Challenge failed with token ${TOKEN}`);
		seen = [];
		const restore = keepLogs();
		try {
			await run();
		} finally {
			restore();
		}
		const [sent] = eventsOf("certificate.renewal_failed", certificate.id);
		assert.match(sent.data.error, GENERIC);
		assert.equal(JSON.stringify(seen).includes(TOKEN), false);
		assert.equal(
			logged.some((line) => line.includes(TOKEN)),
			false,
		);
	});

	it("deleting an ACME certificate clears its renewal_failed state, and a state of a missing certificate goes at the next check", async () => {
		const stuck = await requested("clear.example.com");
		await stale(stuck.id, "2020-06-01 00:00:00");
		await cp(expired.certificate, live(stuck.id));
		await certbotFails(api, "nope");
		await run();
		const states = (id) => api.db(STATE).where({ object_id: String(id) });
		assert.equal((await states(stuck.id).where({ event: "certificate.renewal_failed" })).length, 1);
		assert.equal((await admin.delete(`${CERTS}/${stuck.id}`)).status, 200);
		assert.equal((await states(stuck.id)).length, 0);

		await stateStore.report({ event: "certificate.expiring", objectId: "99999", state: "soon", data: {} });
		await stateStore.report({ event: "certificate.renewal_failed", objectId: "99999", state: "bad", data: {} });
		assert.equal((await states(99999)).length, 2);
		await internalCertificate.checkCertificateExpiry();
		assert.equal((await states(99999)).length, 0);
	});

	it("a layer that throws leaves the run result, the refresh and a single renew unchanged", async () => {
		const one = await requested("layer.example.com");
		await stale(one.id);
		await cp(expired.certificate, live(one.id));
		const original = stateStore.report;
		const targets = notify.channels()[0].targets;
		stateStore.report = () => {
			throw new Error("store broke");
		};
		let targetCalls = 0;
		notify.registerChannel({
			id: "fake",
			accepts: () => true,
			targets: () => {
				targetCalls += 1;
				throw new Error("targets broke");
			},
		});
		const columns = (list) => list.map(({ modified_on, expires_on, npmpro_valid_from, ...rest }) => rest);
		const rowsBefore = columns(await rowsOf());
		try {
			await certbotFails(api, "boom");
			assert.equal(await run(), undefined);
			assert.deepEqual(columns(await rowsOf()), rowsBefore);
			assert.ok(targetCalls > 0);
			assert.equal(internalCertificate.intervalProcessing, false);
			// the refresh of the dates still happened
			assert.equal(
				String((await rowsOf()).find((row) => row.id === one.id).expires_on).slice(0, 10),
				"2020-01-02",
			);

			await certbotSucceeds(api, pair);
			await stale(one.id);
			const renewed = await admin.post(`${CERTS}/${one.id}/renew`, {});
			assert.equal(renewed.status, 200, renewed.text);
			assert.equal((await admin.delete(`${CERTS}/${one.id}`)).status, 200);
		} finally {
			stateStore.report = original;
			notify.registerChannel({ id: "fake", accepts: () => true, targets });
		}
	});
});

const hostEvents = (type, id) => seen.filter((one) => one.type === type && one.data.id === id);
const hostStates = (id) => api.db(STATE).where({ event: "host.config_error" }).whereLike("object_id", `%:${id}`);
const makeProxy = async (name, extra = {}) => {
	const made = await admin.post("/nginx/proxy-hosts", { domain_names: [name], forward_host: "10.0.0.1", ...extra });
	if (made.status !== 201) throw new Error(made.text);
	return made.body;
};
const ADVANCED_LEAK = /secret-advanced-config-text|advanced_config/u;
const LONG_ERROR = `nginx: [emerg] ${"x".repeat(400)}`;

describe("host config state emit points", () => {
	it("a config error sends one event with 300 characters and no advanced config, the fix resolves it", async () => {
		const host = await makeProxy("cfg.example.com", { advanced_config: "# secret-advanced-config-text" });
		assert.equal(seen.length, 0);
		api.outside.control.failNext = LONG_ERROR;
		const bad = await admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 81 });
		assert.equal(bad.body.npmpro_nginx_online, false, bad.text);
		const failed = hostEvents("host.config_error", host.id);
		assert.equal(failed.length, 1);
		assert.equal(failed[0].data.type, "proxy_host");
		assert.deepEqual(failed[0].data.domain_names, ["cfg.example.com"]);
		assert.equal(failed[0].data.error.length, 300);
		assert.doesNotMatch(JSON.stringify(failed[0]), ADVANCED_LEAK);

		// a second failure of the same host sends nothing more
		api.outside.control.failNext = LONG_ERROR;
		await admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 82 });
		assert.equal(hostEvents("host.config_error", host.id).length, 1);

		const fixed = await admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 83 });
		assert.equal(fixed.body.npmpro_nginx_online, true, fixed.text);
		assert.equal(hostEvents("host.config_error.resolved", host.id).length, 1);

		assert.equal((await hostStates(host.id)).length, 1);
		assert.equal((await admin.delete(`/nginx/proxy-hosts/${host.id}`)).status, 200);
		assert.equal((await hostStates(host.id)).length, 0);
	});

	it("a batch success resolves a failed host and sends nothing for healthy ones", async () => {
		const { loadEnabledHosts, regenerateAllHostsNow } = await import("../internal/regenerate.js");
		const hosts = [
			await makeProxy("b1.example.com"),
			await makeProxy("b2.example.com"),
			await makeProxy("b3.example.com"),
		];
		api.outside.control.failNext = LONG_ERROR;
		await admin.put(`/nginx/proxy-hosts/${hosts[1].id}`, { forward_port: 81 });
		assert.equal(hostEvents("host.config_error", hosts[1].id).length, 1);
		seen = [];
		await regenerateAllHostsNow(await loadEnabledHosts());
		assert.equal(hostEvents("host.config_error.resolved", hosts[1].id).length, 1);
		assert.equal(seen.length, 1);

		// every host healthy: a second regeneration is silent
		seen = [];
		await regenerateAllHostsNow(await loadEnabledHosts());
		assert.equal(seen.length, 0);
		for (const one of hosts) assert.equal((await hostStates(one.id)).length, 1);
	});

	it("a layer that throws leaves the host save and delete unchanged", async () => {
		const names = ["reportState", "clearMatching", "clearState", "emit"];
		const originals = Object.fromEntries(names.map((name) => [name, notify[name]]));
		for (const name of names) {
			notify[name] = () => {
				throw new Error("layer broke");
			};
		}
		const restore = keepLogs();
		try {
			const host = await makeProxy("throw.example.com");
			api.outside.control.failNext = "nginx: [emerg] boom";
			const bad = await admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 81 });
			assert.equal(bad.status, 200, bad.text);
			assert.equal(bad.body.npmpro_nginx_online, false);
			assert.equal((await admin.delete(`/nginx/proxy-hosts/${host.id}`)).status, 200);
			assert.ok(logged.some((line) => line.includes("Host notifications")));
		} finally {
			restore();
			Object.assign(notify, originals);
		}
	});
});

describe("GeoIP state emit points", () => {
	it("the first failure sends, the second does not, a success resolves", async () => {
		const { default: setting } = await import("../internal/monitoring-setting.js");
		await setting.recordGeoipResult({ ok: false, error: "download failed" });
		await setting.recordGeoipResult({ ok: false, error: "download failed again" });
		assert.equal(seen.filter((one) => one.type === "geoip.failed").length, 1);
		assert.equal(seen[0].data.error, "download failed");
		await setting.recordGeoipResult({ ok: true, updated: ["city"] });
		assert.equal(seen.filter((one) => one.type === "geoip.failed.resolved").length, 1);
	});

	it("a layer that throws keeps the stored result", async () => {
		const { default: setting } = await import("../internal/monitoring-setting.js");
		const original = notify.reportState;
		notify.reportState = () => {
			throw new Error("layer broke");
		};
		const restore = keepLogs();
		try {
			await setting.recordGeoipResult({ ok: false, error: "kept" });
			assert.equal(
				logged.some((line) => line.includes("GeoIP notification failed")),
				true,
			);
		} finally {
			restore();
			notify.reportState = original;
		}
		const stored = await (await import("../lib/monitoring-config.js")).readStoredGeoip();
		assert.equal(stored.last_error, "kept");
	});
});

describe("backup schedule state emit points", () => {
	const access = { canAdmin: () => true, token: { getUserId: () => 1 } };
	const box = { encrypt: (value) => JSON.stringify(value), decrypt: (value) => JSON.parse(value) };
	const quiet = { info: () => {}, warn: () => {}, error: () => {} };
	let behaviour;
	let service;

	before(async () => {
		const { createScheduleService } = await import("../internal/backup-schedules.js");
		service = (extra = {}) =>
			createScheduleService({
				knex: api.db,
				box,
				log: quiet,
				audit: async () => {},
				notify,
				backup: {
					scheduledBackup: () =>
						behaviour === "fail"
							? Promise.reject(new Error("disk full"))
							: Promise.resolve({ name: "npmpro-backup-1-s1.npmpro", size: 100 }),
				},
				store: {
					pruneSchedule: async () => [],
					detachSchedule: async () => [],
					scheduleCounts: async () => new Map(),
				},
				...extra,
			});
	});
	beforeEach(async () => {
		await api.db("npmpro_backup_schedule").delete();
	});

	const created = (svc, name = "Nightly") =>
		svc.create(access, {
			name,
			frequency: "daily",
			time: "03:00",
			types: ["proxy_hosts"],
			protection: "none",
			keep: 2,
		});

	it("a failing then succeeding schedule sends failed, then resolved and succeeded", async () => {
		const svc = service();
		const { id } = await created(svc);
		behaviour = "fail";
		await svc.runNow(access, id);
		await svc.runNow(access, id);
		assert.equal(seen.filter((one) => one.type === "backup.failed").length, 1);
		assert.equal(seen[0].data.schedule.id, id);
		assert.equal(seen[0].data.error, "disk full");
		behaviour = "ok";
		await svc.runNow(access, id);
		assert.equal(seen.filter((one) => one.type === "backup.failed.resolved").length, 1);
		const succeeded = seen.filter((one) => one.type === "backup.succeeded");
		assert.equal(succeeded.length, 1);
		assert.equal(succeeded[0].data.file, "npmpro-backup-1-s1.npmpro");
		assert.equal(succeeded[0].data.size, 100);
	});

	it("a schedule delete clears its state", async () => {
		const svc = service();
		const { id } = await created(svc);
		behaviour = "fail";
		await svc.runNow(access, id);
		const rows = () => api.db(STATE).where({ event: "backup.failed", object_id: String(id) });
		assert.equal((await rows()).length, 1);
		await svc.remove(access, id);
		assert.equal((await rows()).length, 0);
	});

	it("a layer that throws keeps the run result and the delete", async () => {
		const throwing = {
			reportState: () => {
				throw new Error("layer broke");
			},
			emit: () => {
				throw new Error("layer broke");
			},
			clearState: () => {
				throw new Error("layer broke");
			},
		};
		const svc = service({ notify: throwing });
		const { id } = await created(svc);
		behaviour = "fail";
		const view = await svc.runNow(access, id);
		assert.equal(view.last_status, "failed");
		assert.equal(view.last_error, "disk full");
		behaviour = "ok";
		assert.equal((await svc.runNow(access, id)).last_status, "success");
		await svc.remove(access, id);
		assert.equal((await api.db("npmpro_backup_schedule").where({ id })).length, 0);
	});
});

describe("DDNS record state emit points", () => {
	const record = { id: 41, name: "home.example.com", provider: "cloudflare" };
	const rows = (event) => api.db(STATE).where({ event, object_id: "41" });
	let report;
	let managedRows;

	before(async () => {
		({ reportRecordState: report } = await import("../internal/ddns.js"));
		({ managedRows } = await import("../internal/ddns-record.js"));
	});

	it("a failure, a second failure, a success and a stop", async () => {
		await report(record, { state: "failed", error: "provider said no", meta: {} });
		await report(record, { state: "failed", error: "provider said no again", meta: {} });
		assert.equal(seen.filter((one) => one.type === "ddns.record_failed").length, 1);
		assert.equal(seen[0].data.record.name, "home.example.com");
		assert.equal(seen[0].data.error, "provider said no");
		assert.equal(seen.filter((one) => one.type === "ddns.record_stopped").length, 0);
		await report(record, { state: "ok", error: null, meta: {} });
		assert.equal(seen.filter((one) => one.type === "ddns.record_failed.resolved").length, 1);

		seen = [];
		await report(record, { state: "failed", error: "badauth", meta: { stopped: true } });
		assert.equal(seen.filter((one) => one.type === "ddns.record_stopped").length, 1);
		await report(record, { state: "ok", error: null, meta: {} });
		assert.equal(seen.filter((one) => one.type === "ddns.record_stopped.resolved").length, 1);
	});

	it("a patch without the state or the meta leaves the states alone", async () => {
		await report(record, { state: "failed", error: "x", meta: {} });
		seen = [];
		await report(record, { last_checked_on: new Date() });
		assert.equal(seen.length, 0);
		assert.equal((await rows("ddns.record_failed")).length, 1);
	});

	const insertRow = (id) =>
		api.db("npmpro_ddns_record").insert({
			id,
			owner_user_id: 1,
			name: `r${id}.example.com`,
			provider: "cloudflare",
			zone: "example.com",
			created_on: "2026-01-01 00:00:00",
			modified_on: "2026-01-01 00:00:00",
		});
	const both = async () => (await rows("ddns.record_failed")).length + (await rows("ddns.record_stopped")).length;

	it("a record delete clears both states", async () => {
		await insertRow(41);
		await report(record, { state: "failed", error: "x", meta: { stopped: true } });
		assert.equal(await both(), 2);
		await managedRows.remove(41);
		assert.equal(await both(), 0);
	});

	it("a layer that throws keeps the record delete", async () => {
		await insertRow(41);
		await report(record, { state: "failed", error: "x", meta: {} });
		const original = notify.clearState;
		notify.clearState = () => {
			throw new Error("layer broke");
		};
		const restore = keepLogs();
		try {
			await managedRows.remove(41);
			assert.ok(logged.some((line) => line.includes("could not clear its notification states")));
		} finally {
			restore();
			notify.clearState = original;
		}
		assert.equal((await api.db("npmpro_ddns_record").where({ id: 41 })).length, 0);
	});
});
