import assert from "node:assert/strict";
import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { isoToLocal } from "../lib/backup/rows.js";
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
const EXPIRED_TEXT = /expired/u;
const KEY_PATH = /private_key|\/accounts\//u;
// a certificate date as the database stores it: naive local text (internal/certificate.js)
const sql = (ms) => isoToLocal(new Date(ms).toISOString());

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

	it("a run that exits 0 leaves a due certificate's renewal state alone unless it expired", async () => {
		const soon = await requested("soon0.example.com");
		const gone = await requested("gone0.example.com");
		// no readable file: the run keeps the stored dates
		for (const one of [soon, gone]) await rm(live(one.id), { force: true });
		await api
			.db("certificate")
			.where({ id: soon.id })
			.update({ expires_on: sql(Date.now() + 5 * DAY), npmpro_valid_from: null });
		await stale(gone.id, "2020-06-01 00:00:00");
		const failedState = async (id) =>
			(
				await api
					.db(STATE)
					.where({ event: "certificate.renewal_failed", object_id: String(id) })
					.first()
			)?.state;
		seen = [];
		await run();
		assert.equal(eventsOf("certificate.renewal_failed", soon.id).length, 0);
		assert.equal(await failedState(soon.id), undefined);
		const failed = eventsOf("certificate.renewal_failed", gone.id);
		assert.equal(failed.length, 1);
		assert.match(failed[0].data.error, EXPIRED_TEXT);

		// a failed run marks it, a later run that exits 0 while it is still due leaves it bad, no resolved event
		await certbotFails(api, "Renewal went wrong");
		await run();
		assert.equal(eventsOf("certificate.renewal_failed", soon.id).length, 1);
		await certbotSucceeds(api, pair);
		seen = [];
		await run();
		assert.equal(eventsOf("certificate.renewal_failed.resolved", soon.id).length, 0);
		assert.equal(await failedState(soon.id), "bad");
		for (const one of [soon, gone]) assert.equal((await admin.delete(`${CERTS}/${one.id}`)).status, 200);
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
		const credential = () => api.db("npmpro_dns_credential").where({ id: credentialId });
		const [{ values }] = await credential();
		await credential().update({ values: "v1:broken" });
		await certbotFails(api, `Challenge failed with token ${TOKEN}`);
		seen = [];
		const restore = keepLogs();
		try {
			await run();
		} finally {
			restore();
			// a later backup (the automatic one of a restore) opens every credential
			await credential().update({ values });
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
const settle = async () => (await import("../internal/host-notify.js")).settledHostReports();
const URL_SECRETS = /pw123|abc9876/u;
const HEADER_SECRETS = /bearer-tok-1122|dXNlcjpiYXNpYy0zMzQ0|plain-auth-5566/u;
const INVALID_HEADER = /invalid header \*\*\*/u;
const SECRET_META = /secret-advanced-config-text|advanced_config|locations|"meta"|@/u;
const PASSPHRASE = /secret-pass-1/u;
const LAPI_KEY = /lapi-key-9/u;
const NOT_STORED = /not stored/u;
const LONG_ERROR = `nginx: [emerg] ${"x".repeat(400)}`;

describe("host config state emit points", () => {
	it("a config error sends one event with 300 characters and no advanced config, the fix resolves it", async () => {
		const host = await makeProxy("cfg.example.com", { advanced_config: "# secret-advanced-config-text" });
		assert.equal(seen.filter((one) => one.type !== "host.created").length, 0);
		api.outside.control.failNext = LONG_ERROR;
		const bad = await admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 81 });
		assert.equal(bad.body.npmpro_nginx_online, false, bad.text);
		await settle();
		const failed = hostEvents("host.config_error", host.id);
		assert.equal(failed.length, 1);
		assert.equal(failed[0].data.type, "proxy_host");
		assert.deepEqual(failed[0].data.domain_names, ["cfg.example.com"]);
		assert.equal(failed[0].data.error.length, 300);
		assert.doesNotMatch(JSON.stringify(failed[0]), ADVANCED_LEAK);

		// a second failure of the same host sends nothing more
		api.outside.control.failNext = LONG_ERROR;
		await admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 82 });
		await settle();
		assert.equal(hostEvents("host.config_error", host.id).length, 1);

		const fixed = await admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 83 });
		assert.equal(fixed.body.npmpro_nginx_online, true, fixed.text);
		await settle();
		assert.equal(hostEvents("host.config_error.resolved", host.id).length, 1);

		assert.equal((await hostStates(host.id)).length, 1);
		assert.equal((await admin.delete(`/nginx/proxy-hosts/${host.id}`)).status, 200);
		await settle();
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
		await settle();
		assert.equal(hostEvents("host.config_error", hosts[1].id).length, 1);
		seen = [];
		await regenerateAllHostsNow(await loadEnabledHosts());
		await settle();
		assert.equal(hostEvents("host.config_error.resolved", hosts[1].id).length, 1);
		assert.equal(seen.length, 1);

		// every host healthy: a second regeneration is silent
		seen = [];
		await regenerateAllHostsNow(await loadEnabledHosts());
		await settle();
		assert.equal(seen.length, 0);
		for (const one of hosts) assert.equal((await hostStates(one.id)).length, 1);
	});

	it("disabling a failed host clears its state without an event, enabling records it afresh", async () => {
		const host = await makeProxy("off.example.com");
		api.outside.control.failNext = LONG_ERROR;
		await admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 81 });
		await settle();
		assert.equal(hostEvents("host.config_error", host.id).length, 1);
		seen = [];
		assert.equal((await admin.post(`/nginx/proxy-hosts/${host.id}/disable`)).status, 200);
		await settle();
		assert.equal((await hostStates(host.id)).length, 0);
		assert.equal(hostEvents("host.config_error.resolved", host.id).length, 0);
		// a configure report that lands for the disabled host stores nothing
		const { reportHostConfig } = await import("../internal/host-notify.js");
		await reportHostConfig("proxy_host", host, { npmpro_nginx_online: false, npmpro_nginx_err: "late" });
		assert.equal((await hostStates(host.id)).length, 0);
		api.outside.control.failNext = LONG_ERROR;
		assert.equal((await admin.post(`/nginx/proxy-hosts/${host.id}/enable`)).status, 200);
		await settle();
		assert.equal(hostEvents("host.config_error", host.id).length, 1);
		assert.equal((await hostStates(host.id)).length, 1);
		assert.equal((await admin.delete(`/nginx/proxy-hosts/${host.id}`)).status, 200);
		await settle();
	});

	it("a host restored under an id that had a bad state sends no resolved event and is recorded afresh", async () => {
		const host = await makeProxy("restored.example.com");
		await settle();
		const made = await admin.post("/backups", { types: ["proxy_hosts"], secrets: false, keep: true });
		assert.equal(made.status, 200, made.text);
		api.outside.control.failNext = LONG_ERROR;
		await admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 81 });
		await settle();
		assert.equal(hostEvents("host.config_error", host.id).length, 1);
		await api.db(STATE).insert({
			key: "geoip.failed:geoip",
			event: "geoip.failed",
			object_id: "geoip",
			state: "bad",
			since: sql(Date.now()),
			data: "{}",
		});
		seen = [];
		const opened = await admin.post(`/backups/${made.body.entry.name}/inspect`, {});
		assert.equal(opened.status, 200, opened.text);
		const restored = await admin.post(`/backups/restore/${opened.body.token}`, {
			mode: "replace",
			types: ["proxy_hosts"],
			confirm: true,
		});
		assert.equal(restored.status, 200, restored.text);
		await settle();
		assert.equal(hostEvents("host.config_error.resolved", host.id).length, 0);
		assert.deepEqual(
			(await hostStates(host.id)).map((row) => row.state),
			["ok"],
		);
		// a type the restore did not replace keeps its state
		assert.equal((await api.db(STATE).where({ key: "geoip.failed:geoip" }).first()).state, "bad");
		await api.db(STATE).where({ key: "geoip.failed:geoip" }).delete();
		assert.equal((await admin.delete(`/nginx/proxy-hosts/${host.id}`)).status, 200);
		await settle();
	});

	it("an nginx error with a URL password and an access list password reaches neither the event nor a log line", async () => {
		const restore = keepLogs();
		try {
			const list = await admin.post("/nginx/access-lists", {
				name: "secret list",
				items: [{ username: "alice", password: "list-pw-4455" }],
			});
			assert.equal(list.status, 201, list.text);
			const host = await makeProxy("leak.example.com", {
				forward_host: "user:pw123@up.example",
				npmpro_access_list_type: "custom",
				npmpro_access_list_ids: [list.body.id],
			});
			const [{ password: stored }] = await api.db("access_list_auth").where({ access_list_id: list.body.id });
			api.outside.control.failNext = `nginx: [emerg] host not found in upstream http://user:pw123@up.example/x?token=abc9876 and ${stored}`;
			await admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 81 });
			await settle();
			const [event] = hostEvents("host.config_error", host.id);
			assert.ok(event, "an event");
			const everything = JSON.stringify(event) + logged.join("\n");
			assert.doesNotMatch(everything, URL_SECRETS);
			assert.equal(everything.includes(stored), false);
		} finally {
			restore();
		}
	});

	it("an Authorization header value and a Basic or Bearer value in the advanced config never reach the event", async () => {
		const host = await makeProxy("auth.example.com", {
			advanced_config: [
				'proxy_set_header Authorization "Bearer bearer-tok-1122";',
				"proxy_set_header X-Upstream-Auth Basic dXNlcjpiYXNpYy0zMzQ0;",
				"proxy_set_header Authorization plain-auth-5566;",
			].join("\n"),
		});
		api.outside.control.failNext =
			"nginx: [emerg] invalid header bearer-tok-1122 dXNlcjpiYXNpYy0zMzQ0 plain-auth-5566 in /data/nginx/proxy_host/1.conf";
		await admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 81 });
		await settle();
		const [event] = hostEvents("host.config_error", host.id);
		assert.ok(event, "an event");
		assert.doesNotMatch(JSON.stringify(event), HEADER_SECRETS);
		assert.match(event.data.error, INVALID_HEADER);
		assert.equal((await admin.delete(`/nginx/proxy-hosts/${host.id}`)).status, 200);
		await settle();
	});

	it("a slow state report does not delay the configure result", async () => {
		const host = await makeProxy("slow.example.com");
		await settle();
		const original = notify.reportState;
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		notify.reportState = async (...args) => {
			await gate;
			return original(...args);
		};
		try {
			api.outside.control.failNext = "nginx: [emerg] slow";
			const saved = await Promise.race([
				admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 81 }),
				new Promise((resolve) => setTimeout(resolve, 5000, "timeout")),
			]);
			assert.notEqual(saved, "timeout");
			assert.equal(saved.body.npmpro_nginx_online, false);
		} finally {
			release();
			notify.reportState = original;
		}
		await settle();
		assert.equal(hostEvents("host.config_error", host.id).length, 1);
	});

	it("a report that lands after its host was deleted leaves no state", async () => {
		const host = await makeProxy("late.example.com");
		await settle();
		assert.equal((await admin.delete(`/nginx/proxy-hosts/${host.id}`)).status, 200);
		await settle();
		const { reportHostConfig } = await import("../internal/host-notify.js");
		await reportHostConfig("proxy_host", host, {
			npmpro_nginx_online: false,
			npmpro_nginx_err: "nginx: [emerg] late",
		});
		assert.equal((await hostStates(host.id)).length, 0);
		assert.equal(hostEvents("host.config_error", host.id).length, 0);
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

	it("disabling a failed schedule clears its state without an event, enabling lets the next run record it", async () => {
		const svc = service();
		const { id } = await created(svc);
		behaviour = "fail";
		await svc.runNow(access, id);
		const rows = () => api.db(STATE).where({ event: "backup.failed", object_id: String(id) });
		assert.equal((await rows()).length, 1);
		seen = [];
		await svc.update(access, id, { enabled: false });
		assert.equal((await rows()).length, 0);
		// a Run now of the disabled schedule records no state
		await svc.runNow(access, id);
		assert.equal((await rows()).length, 0);
		assert.equal(seen.length, 0);
		await svc.update(access, id, { enabled: true });
		await svc.runNow(access, id);
		assert.equal(seen.filter((one) => one.type === "backup.failed").length, 1);
		assert.equal((await rows()).length, 1);
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

	it("a record paused or set aside clears both states without an event, and its run's report stores none", async () => {
		await insertRow(41);
		await report(record, { state: "failed", error: "x", meta: { stopped: true } });
		assert.equal(await both(), 2);
		seen = [];
		await managedRows.patch(41, { enabled: false, state: "disabled" });
		assert.equal(await both(), 0);
		await report(record, { enabled: false, state: "disabled", meta: {} });
		assert.equal(await both(), 0);
		assert.equal(seen.length, 0);
		await managedRows.patch(41, { enabled: true, state: "pending" });
		await report(record, { state: "failed", error: "y", meta: {} });
		assert.equal(seen.filter((one) => one.type === "ddns.record_failed").length, 1);
		await managedRows.remove(41);
	});

	it("a record the user disables clears both states without an event", async () => {
		const made = await admin.post("/nginx/dns-credentials", {
			name: "ddns off credential",
			provider: "cloudflare",
			fields: [{ key: "dns_cloudflare_api_token", value: TOKEN }],
		});
		assert.equal(made.status, 201, made.text);
		const domain = await admin.post("/nginx/dns-domains", {
			dns_credential_id: made.body.id,
			names: ["off.example"],
		});
		assert.equal(domain.status, 201, domain.text);
		const added = await admin.post("/nginx/ddns-records", {
			name: "home.off.example",
			dns_credential_id: made.body.id,
		});
		assert.equal(added.status, 201, added.text);
		const id = added.body.id;
		const states = () =>
			api
				.db(STATE)
				.whereIn("event", ["ddns.record_failed", "ddns.record_stopped"])
				.where({ object_id: String(id) });
		await report(
			{ id, name: "home.off.example", provider: "cloudflare" },
			{ state: "failed", error: "x", meta: { stopped: true } },
		);
		assert.equal((await states()).length, 2);
		seen = [];
		const off = await admin.put(`/nginx/ddns-records/${id}`, { enabled: false });
		assert.equal(off.status, 200, off.text);
		assert.equal((await states()).length, 0);
		assert.equal(seen.length, 0);
		assert.equal((await admin.delete(`/nginx/ddns-records/${id}`)).status, 200);
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

describe("CrowdSec state emit points", () => {
	let reportCrowdsecState;
	before(async () => {
		({ reportCrowdsecState } = await import("../internal/monitoring-services.js"));
	});
	const rows = () => api.db(STATE).where({ event: "crowdsec.unreachable" });

	it("bad sends once however often it is told, ok resolves, off clears, no key in the data", async () => {
		const down = { state: "bad", error: "request failed with key lapi-key-9", secrets: ["lapi-key-9"] };
		await reportCrowdsecState(down);
		await reportCrowdsecState(down);
		await reportCrowdsecState(down);
		const sent = seen.filter((one) => one.type === "crowdsec.unreachable");
		assert.equal(sent.length, 1);
		assert.doesNotMatch(JSON.stringify(sent[0]), LAPI_KEY);
		await reportCrowdsecState({ state: "ok" });
		assert.equal(seen.filter((one) => one.type === "crowdsec.unreachable.resolved").length, 1);
		assert.equal((await rows()).length, 1);
		await reportCrowdsecState({ state: "off" });
		assert.equal((await rows()).length, 0);
	});

	it("while the notifications are paused nothing is written and the state is not told", async () => {
		const { worker } = await import("../internal/notify.js");
		worker.pause();
		try {
			assert.equal(await reportCrowdsecState({ state: "bad", error: "down" }), false);
			assert.equal(await reportCrowdsecState({ state: "off" }), false);
			assert.equal((await rows()).length, 0);
			assert.equal(seen.length, 0);
		} finally {
			worker.resume();
		}
		assert.notEqual(await reportCrowdsecState({ state: "bad", error: "down" }), false);
		assert.equal((await rows()).length, 1);
		await reportCrowdsecState({ state: "off" });
	});

	it("a state that could not be stored throws, so the service tries again", async () => {
		const original = stateStore.report;
		stateStore.report = () => {
			throw new Error("store broke");
		};
		const restore = keepLogs();
		try {
			await assert.rejects(reportCrowdsecState({ state: "ok" }), NOT_STORED);
		} finally {
			restore();
			stateStore.report = original;
		}
	});
});

describe("action events from the audit hook", () => {
	let internalAuditLog;
	let checkDatabaseMoved;
	const MOVED = "database.moved:audit";
	const actions = () => seen.filter((one) => one.type.startsWith("host."));
	const waitFor = async (count, pick = () => seen) => {
		for (let tries = 0; tries < 100 && pick().length < count; tries += 1) {
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	};
	const quiet = () => new Promise((resolve) => setTimeout(resolve, 100));
	before(async () => {
		internalAuditLog = (await import("../internal/audit-log.js")).default;
		({ checkDatabaseMoved } = await import("../internal/notify.js"));
	});

	it("a host create, update, disable, enable and delete each send one host event without the config or the meta", async () => {
		const host = await makeProxy("act.example.com", {
			advanced_config: "# secret-advanced-config-text",
			locations: [{ path: "/x", forward_host: "10.0.0.2", forward_port: 80, forward_scheme: "http" }],
		});
		await waitFor(1, actions);
		assert.equal((await admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 81 })).status, 200);
		await waitFor(2, actions);
		assert.equal((await admin.post(`/nginx/proxy-hosts/${host.id}/disable`)).status, 200);
		await waitFor(3, actions);
		assert.equal((await admin.post(`/nginx/proxy-hosts/${host.id}/enable`)).status, 200);
		await waitFor(4, actions);
		assert.equal((await admin.delete(`/nginx/proxy-hosts/${host.id}`)).status, 200);
		await waitFor(5, actions);
		await settle();
		const sent = actions().filter((one) => !one.type.includes("config_error"));
		assert.deepEqual(
			sent.map((one) => one.type),
			["host.created", "host.updated", "host.disabled", "host.enabled", "host.deleted"],
		);
		for (const one of sent) {
			assert.equal(one.data.id, host.id);
			assert.equal(one.data.type, "proxy_host");
			assert.deepEqual(one.data.domain_names, ["act.example.com"]);
			assert.equal(typeof one.data.user.id, "number");
			assert.doesNotMatch(JSON.stringify(one), SECRET_META);
		}
	});

	it("a certificate create and delete send certificate events", async () => {
		const made = await requested("issued.example.com");
		await waitFor(1);
		assert.equal((await admin.delete(`${CERTS}/${made.id}`)).status, 200);
		await waitFor(2, () =>
			seen.filter((one) => one.type.startsWith("certificate.") && !one.type.includes("expir")),
		);
		assert.equal(eventsOf("certificate.issued", made.id).length, 1);
		assert.equal(eventsOf("certificate.deleted", made.id).length, 1);
	});

	it("a backup restore and a database move failure send events, another type nothing", async () => {
		await internalAuditLog.add(null, {
			user_id: 1,
			action: "restored",
			object_type: "backup",
			object_id: 0,
			meta: { name: "b.zip", types: ["hosts", "certificates"], passphrase: "secret-pass-1" },
		});
		await internalAuditLog.add(null, {
			user_id: 1,
			action: "move-failed",
			object_type: "database",
			object_id: 0,
			meta: {
				name: "postgres db:5432/npmpro",
				from: "sqlite /data/npmpro/database.sqlite",
				step: "copy",
				error: "boom",
			},
		});
		await internalAuditLog.add(null, { user_id: 1, action: "updated", object_type: "setting", meta: { id: "x" } });
		await waitFor(2);
		assert.deepEqual(seen.map((one) => one.type).sort(), ["backup.restored", "database.move_failed"]);
		assert.deepEqual(seen.find((one) => one.type === "database.move_failed").data, {
			from: "sqlite /data/npmpro/database.sqlite",
			to: "postgres db:5432/npmpro",
			error: "boom",
		});
		assert.deepEqual(seen.find((one) => one.type === "backup.restored").data.types, ["hosts", "certificates"]);
		assert.doesNotMatch(JSON.stringify(seen), PASSPHRASE);
	});

	it("an add whose notify call throws still resolves the inserted row", async () => {
		const original = notify.emit;
		const unhandled = [];
		const onUnhandled = (reason) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		const restore = keepLogs();
		notify.emit = () => {
			throw new Error("emit broke");
		};
		try {
			const row = await internalAuditLog.add(null, {
				user_id: 1,
				action: "restored",
				object_type: "backup",
				object_id: 0,
				meta: { types: ["hosts"] },
			});
			assert.equal(row.action, "restored");
			assert.ok(row.id > 0);
			await quiet();
			assert.ok(
				logged.some((line) => line.includes("the audit event failed: emit broke")),
				logged.join("\n"),
			);
			assert.deepEqual(unhandled, []);
		} finally {
			restore();
			process.off("unhandledRejection", onUnhandled);
			notify.emit = original;
		}
	});

	describe("checkDatabaseMoved", () => {
		const movedRow = (from, to) =>
			internalAuditLog.add(null, {
				user_id: 1,
				action: "moved",
				object_type: "database",
				object_id: 0,
				meta: { name: to, from },
			});
		// audit times have a one second grain
		const later = () => new Promise((resolve) => setTimeout(resolve, 1100));
		beforeEach(async () => {
			await api.db(STATE).where({ key: MOVED }).delete();
			await api.db("audit_log").where({ object_type: "database", action: "moved" }).delete();
		});

		it("with no state row it stores the watermark silently, a newer row sends one event, the same row again none", async () => {
			const first = await movedRow("sqlite", "postgres a");
			await checkDatabaseMoved();
			await quiet();
			assert.equal(seen.length, 0);
			const stored = await api.db(STATE).where({ key: MOVED }).first();
			assert.equal(stored.state, "ok");
			assert.equal(JSON.parse(stored.data).id, first.id);

			await checkDatabaseMoved();
			await quiet();
			assert.equal(seen.length, 0);

			await later();
			const second = await movedRow("postgres a", "mysql b");
			await checkDatabaseMoved();
			await waitFor(1);
			assert.equal(seen.length, 1);
			assert.equal(seen[0].type, "database.moved");
			assert.equal(seen[0].data.from, "postgres a");
			assert.equal(seen[0].data.to, "mysql b");
			assert.equal(JSON.parse((await api.db(STATE).where({ key: MOVED }).first()).data).id, second.id);

			await checkDatabaseMoved();
			await quiet();
			assert.equal(seen.length, 1);
		});

		it("with no moved row at the first start the watermark is stored, and the first move sends one event", async () => {
			await checkDatabaseMoved();
			await quiet();
			assert.equal(JSON.parse((await api.db(STATE).where({ key: MOVED }).first()).data).id, 0);
			assert.equal(seen.length, 0);
			await movedRow("sqlite", "postgres first");
			await checkDatabaseMoved();
			await waitFor(1);
			assert.equal(seen.length, 1);
			assert.equal(seen[0].data.to, "postgres first");
			await checkDatabaseMoved();
			await quiet();
			assert.equal(seen.length, 1);
		});

		it("a moved row created later with a lower id than the watermark sends one event, then none", async () => {
			const high = await movedRow("a", "b");
			await api
				.db("audit_log")
				.where({ id: high.id })
				.update({ id: high.id + 1000 });
			await checkDatabaseMoved();
			await quiet();
			assert.equal(seen.length, 0);
			await later();
			const low = await movedRow("b", "c");
			await api.db("audit_log").where({ id: low.id }).update({ id: -7 });
			await checkDatabaseMoved();
			await waitFor(1);
			assert.equal(seen.length, 1);
			assert.equal(seen[0].data.to, "c");
			await checkDatabaseMoved();
			await quiet();
			assert.equal(seen.length, 1);
		});
	});
});
