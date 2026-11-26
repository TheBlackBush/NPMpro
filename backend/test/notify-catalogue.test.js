import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildData,
	CATALOGUE,
	clean,
	eventById,
	isSelectable,
	makeEnvelope,
	messageId,
	resolvedOf,
	stateEvents,
} from "../lib/notify/catalogue.js";

const MSG_ID = /^msg_[a-z2-7]{26}$/u;
const NO_SECRET = /SECRET|ann@example\.com/u;
const NO_TOKEN = /SECRET-TOKEN/u;
const UNKNOWN = /Unknown notification event/u;

const SECRET_VALUES = {
	advanced_config: "proxy_set_header X-Key SECRET-ADV;",
	meta: { dns_provider_credentials: "SECRET-META" },
	certificate_key: "SECRET-PRIVATE-KEY",
	password: "SECRET-PASSWORD",
	token: "SECRET-TOKEN",
	api_key: "SECRET-APIKEY",
	secret: "SECRET-SECRET",
	access_list: { password: "SECRET-ACL", clients: [{ password: "SECRET-CLIENT" }] },
	locations: [{ path: "/", advanced_config: "SECRET-LOCATION" }],
};

const richSource = () => ({
	...SECRET_VALUES,
	id: 7,
	type: "proxy_host",
	nice_name: "Example",
	domain_names: ["a.example.com"],
	incoming_port: 8080,
	provider: "letsencrypt",
	expires_on: "2027-01-01T00:00:00Z",
	enabled: 1,
	state: "soon",
	days_left: 9,
	error: "failed with SECRET-TOKEN in it",
	secrets: ["SECRET-TOKEN"],
	user: { id: 3, name: "Ann", email: "ann@example.com", password: "SECRET-USER" },
	schedule: { id: 2, name: "Nightly", password: "SECRET-SCHEDULE" },
	record: { id: 5, name: "home", provider: "duckdns", token: "SECRET-RECORD" },
	webhook: { id: 1, name: "hook", url: "https://example.com/?k=SECRET-URL" },
	reason: "gone",
	file: "backup.zip",
	size: 1234,
	types: ["database"],
	from: "SQLite",
	to: "Postgres",
	version: "1.0.0",
});

describe("the notification catalogue", () => {
	it("has unique ids and a resolved twin for every state event", () => {
		const ids = CATALOGUE.map((entry) => entry.id);
		assert.equal(new Set(ids).size, ids.length);
		assert.equal(stateEvents().length, 8);
		for (const entry of stateEvents()) {
			const twin = eventById(resolvedOf(entry.id));
			assert.ok(twin, entry.id);
			assert.equal(twin.data, entry.data);
			assert.equal(twin.kind, "state");
			assert.deepEqual(twin.channels, ["mail", "webhook"]);
		}
		assert.equal(resolvedOf("host.config_error"), "host.config_error.resolved");
	});

	it("sends action events to webhooks only, except webhook.disabled", () => {
		for (const entry of CATALOGUE.filter((item) => item.kind === "action")) {
			if (entry.id === "webhook.disabled" || entry.id === "notification.test") continue;
			assert.deepEqual(entry.channels, ["webhook"], entry.id);
		}
		assert.deepEqual(eventById("webhook.disabled").channels, ["mail", "webhook"]);
		assert.equal(isSelectable("host.created", "mail"), false);
		assert.equal(isSelectable("host.created", "webhook"), true);
		assert.equal(isSelectable("certificate.expiring", "mail"), true);
		assert.equal(isSelectable("nope", "mail"), false);
	});

	it("is frozen", () => {
		assert.ok(Object.isFrozen(CATALOGUE));
		for (const entry of CATALOGUE) {
			assert.ok(Object.isFrozen(entry), entry.id);
			assert.ok(Object.isFrozen(entry.channels), entry.id);
		}
	});

	it("never offers notification.test", () => {
		assert.equal(isSelectable("notification.test", "mail"), false);
		assert.equal(isSelectable("notification.test", "webhook"), false);
	});

	it("rejects an unknown event", () => {
		assert.throws(() => buildData("nope", {}), UNKNOWN);
	});
});

describe("event data builders", () => {
	it("pass none of a record full of secrets", () => {
		for (const entry of CATALOGUE) {
			const json = JSON.stringify(buildData(entry.id, richSource()));
			assert.doesNotMatch(json, NO_SECRET, entry.id);
			for (const key of Object.keys(SECRET_VALUES)) {
				assert.ok(!json.includes(`"${key}"`), `${entry.id} holds ${key}`);
			}
			assert.ok(!json.includes("undefined"), entry.id);
		}
	});

	it("scrubs an error that holds a secret of its own list in every event", () => {
		const source = {
			...richSource(),
			error: "boom SECRET-TOKEN boom",
			secrets: ["SECRET-TOKEN"],
			reason: "SECRET-X",
		};
		for (const entry of CATALOGUE) {
			const json = JSON.stringify(buildData(entry.id, { ...source, reason: undefined }));
			assert.doesNotMatch(json, NO_TOKEN, entry.id);
		}
	});

	it("passes only strings and finite numbers, scrubbed and cut", () => {
		const data = buildData("webhook.disabled", {
			reason: { nested: "SECRET" },
			webhook: { id: {}, name: "x".repeat(400) },
		});
		assert.deepEqual(data, { webhook: { name: "x".repeat(300) } });
		assert.equal(buildData("webhook.disabled", { reason: "a\nb" }).reason, "a b");
		assert.equal(buildData("backup.succeeded", { size: Number.NaN, file: ["f"] }).size, undefined);
	});

	it("reads a datetime without a zone as the server's local time, so the ISO date is the real instant", () => {
		const before = process.env.TZ;
		process.env.TZ = "Pacific/Auckland";
		try {
			// +13:00 in January
			assert.equal(
				buildData("certificate.issued", { expires_on: "2027-01-01 00:00:00" }).expires_on,
				"2026-12-31T11:00:00.000Z",
			);
			assert.equal(
				buildData("certificate.issued", { expires_on: "2027-01-01T05:06:07" }).expires_on,
				"2026-12-31T16:06:07.000Z",
			);
			assert.equal(
				buildData("certificate.issued", { expires_on: "2027-01-01T00:00:00Z" }).expires_on,
				"2027-01-01T00:00:00.000Z",
			);
			process.env.TZ = "Europe/Berlin";
			// a notAfter of 2027-01-01T00:00:00Z is stored as 01:00:00 under Berlin time (internal/certificate.js)
			for (const id of ["certificate.issued", "certificate.renewed", "certificate.expiring"]) {
				assert.equal(
					buildData(id, { expires_on: "2027-01-01 01:00:00" }).expires_on,
					"2027-01-01T00:00:00.000Z",
					id,
				);
			}
		} finally {
			if (before === undefined) delete process.env.TZ;
			else process.env.TZ = before;
		}
	});

	it("builds the certificate fields", () => {
		const data = buildData("certificate.expiring", richSource());
		assert.deepEqual(data, {
			id: 7,
			nice_name: "Example",
			domain_names: ["a.example.com"],
			provider: "letsencrypt",
			expires_on: "2027-01-01T00:00:00.000Z",
			state: "soon",
			days_left: 9,
		});
		assert.equal(buildData("certificate.renewal_failed", richSource()).error, "failed with *** in it");
	});

	it("builds host fields, streams by port and actions with the user", () => {
		assert.deepEqual(buildData("host.created", richSource()), {
			type: "proxy_host",
			id: 7,
			domain_names: ["a.example.com"],
			enabled: true,
			user: { id: 3, name: "Ann" },
		});
		const stream = buildData("host.updated", { ...richSource(), type: "stream" });
		assert.equal(stream.incoming_port, 8080);
		assert.ok(!("domain_names" in stream));
		const error = buildData("host.config_error", { type: "stream", id: 1, error: "x".repeat(400) });
		assert.equal(error.error.length, 300);
		assert.ok(!("user" in error));
	});

	it("builds backup, geoip, crowdsec, ddns, database and webhook fields", () => {
		const source = richSource();
		assert.deepEqual(buildData("backup.failed", source), {
			schedule: { id: 2, name: "Nightly" },
			error: "failed with *** in it",
		});
		assert.deepEqual(buildData("backup.succeeded", source), {
			schedule: { id: 2, name: "Nightly" },
			file: "backup.zip",
			size: 1234,
		});
		assert.deepEqual(buildData("backup.restored", source), { types: ["database"] });
		assert.deepEqual(buildData("geoip.failed", source), { error: "failed with *** in it" });
		assert.deepEqual(buildData("crowdsec.unreachable", source), { error: "failed with *** in it" });
		assert.deepEqual(buildData("ddns.record_failed", source), {
			record: { id: 5, name: "home", provider: "duckdns" },
			error: "failed with *** in it",
		});
		assert.deepEqual(buildData("database.moved", source), {
			from: "SQLite",
			to: "Postgres",
			error: "failed with *** in it",
		});
		assert.deepEqual(buildData("webhook.disabled", source), { webhook: { id: 1, name: "hook" }, reason: "gone" });
		assert.deepEqual(buildData("notification.test", source), { version: "1.0.0" });
	});

	it("leaves out a missing field and survives an empty source", () => {
		assert.deepEqual(buildData("backup.failed", {}), {});
		assert.deepEqual(buildData("host.deleted", undefined), {});
		assert.deepEqual(buildData("certificate.issued", { id: 1, expires_on: new Date("2027-02-03T04:05:06Z") }), {
			id: 1,
			expires_on: "2027-02-03T04:05:06.000Z",
		});
		assert.equal(buildData("certificate.issued", { expires_on: "not a date" }).expires_on, "not a date");
	});
});

describe("clean", () => {
	it("replaces secret values and cuts to 300 characters", () => {
		assert.equal(clean("token abcd1234 here", ["abcd1234"]), "token *** here");
		assert.equal(clean("x".repeat(301)).length, 300);
		assert.equal(clean(undefined), "");
	});
});

describe("the envelope", () => {
	it("builds a message id of 26 base32 characters", () => {
		assert.match(messageId(), MSG_ID);
		assert.equal(messageId(Buffer.alloc(16)), `msg_${"a".repeat(26)}`);
		assert.equal(messageId(Buffer.alloc(16, 255)), `msg_${"7".repeat(25)}${"4"}`);
		assert.notEqual(messageId(), messageId());
	});

	it("leaves a small envelope untouched", () => {
		const now = new Date("2026-11-25T10:00:00Z");
		const envelope = makeEnvelope("host.created", { id: 1 }, { now, randomId: () => "msg_fixed" });
		assert.deepEqual(envelope, {
			id: "msg_fixed",
			type: "host.created",
			timestamp: "2026-11-25T10:00:00.000Z",
			data: { id: 1 },
		});
	});

	it("has an id and an ISO timestamp by default", () => {
		const envelope = makeEnvelope("host.created", { id: 1 });
		assert.match(envelope.id, MSG_ID);
		assert.equal(new Date(envelope.timestamp).toISOString(), envelope.timestamp);
	});

	it("cuts a 500-name list under 20 KB and marks it truncated", () => {
		const domain_names = Array.from({ length: 500 }, (_, i) => `host-${i}-${"x".repeat(60)}.example.com`);
		const envelope = makeEnvelope("host.created", { id: 1, domain_names });
		assert.ok(Buffer.byteLength(JSON.stringify(envelope)) <= 20 * 1024);
		assert.equal(envelope.data.truncated, true);
		assert.ok(envelope.data.domain_names.length > 0 && envelope.data.domain_names.length < 500);
		assert.deepEqual(envelope.data.domain_names, domain_names.slice(0, envelope.data.domain_names.length));
	});

	it("cuts a single huge string to fit", () => {
		const envelope = makeEnvelope("host.config_error", { error: "e".repeat(50000) });
		assert.ok(Buffer.byteLength(JSON.stringify(envelope)) <= 20 * 1024);
		assert.equal(envelope.data.truncated, true);
		assert.ok(envelope.data.error.length > 1000);
	});

	it("cuts a string when a list alone does not fit", () => {
		const envelope = makeEnvelope("x", { names: ["a"], error: "e".repeat(50000) });
		assert.ok(Buffer.byteLength(JSON.stringify(envelope)) <= 20 * 1024);
		assert.equal(envelope.data.truncated, true);
		assert.deepEqual(envelope.data.names, []);
	});
});
