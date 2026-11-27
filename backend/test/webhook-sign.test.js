import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Webhook } from "standardwebhooks";
import { newSecret, signatureHeader, webhookHeaders } from "../lib/notify/webhook-sign.js";

// the symmetric vector of the Standard Webhooks libraries' tests
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const TIMESTAMP = 1614265330;
const BODY = '{"test": 2432232314}';
const SIGNATURE_ENTRY = /^v1,[A-Za-z0-9+/]+=*$/u;
const SECRET_FORMAT = /^whsec_[A-Za-z0-9+/]{43}=$/u;
const EXPECTED = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";

describe("webhook signing", () => {
	it("signs the reference vector exactly", () => {
		assert.equal(signatureHeader({ id: ID, timestamp: TIMESTAMP, body: BODY, secrets: [SECRET] }), EXPECTED);
	});

	it("gives two space separated entries for two secrets, the first one the current", () => {
		const other = newSecret();
		const header = signatureHeader({ id: ID, timestamp: TIMESTAMP, body: BODY, secrets: [SECRET, other] });
		const parts = header.split(" ");
		assert.equal(parts.length, 2);
		assert.equal(parts[0], EXPECTED);
		assert.match(parts[1], SIGNATURE_ENTRY);
		assert.notEqual(parts[1], EXPECTED);
	});

	it("signs the exact body string, so a re-serialised body does not match", () => {
		const compact = JSON.stringify(JSON.parse(BODY));
		assert.notEqual(compact, BODY);
		assert.notEqual(signatureHeader({ id: ID, timestamp: TIMESTAMP, body: compact, secrets: [SECRET] }), EXPECTED);
	});

	it("makes secrets of 32 random bytes with the prefix", () => {
		const secret = newSecret();
		assert.match(secret, SECRET_FORMAT);
		assert.equal(Buffer.from(secret.slice(6), "base64").length, 32);
		assert.notEqual(secret, newSecret());
	});

	it("builds the five lower case headers", () => {
		const headers = webhookHeaders({
			id: ID,
			timestamp: TIMESTAMP,
			body: BODY,
			secrets: [SECRET],
			version: "1.2.3",
		});
		assert.deepEqual(
			Object.keys(headers).sort((a, b) => a.localeCompare(b)),
			["content-type", "user-agent", "webhook-id", "webhook-signature", "webhook-timestamp"],
		);
		assert.equal(headers["content-type"], "application/json");
		assert.equal(headers["user-agent"], "NPMpro-Webhooks/1.2.3");
		assert.equal(headers["webhook-id"], ID);
		assert.ok(!headers["webhook-id"].includes("."));
		assert.equal(headers["webhook-timestamp"], "1614265330");
		assert.equal(headers["webhook-signature"], EXPECTED);
	});

	it("is accepted by the standardwebhooks library, with either secret while two are signed", () => {
		const now = Math.floor(Date.now() / 1000);
		const current = newSecret();
		const previous = newSecret();
		const body = JSON.stringify({ type: "notification.test", timestamp: new Date().toISOString(), data: {} });
		const headers = webhookHeaders({
			id: "msg_abc",
			timestamp: now,
			body,
			secrets: [current, previous],
			version: "0",
		});
		for (const secret of [current, previous]) {
			assert.deepEqual(new Webhook(secret).verify(body, headers), JSON.parse(body));
		}
		assert.throws(() => new Webhook(newSecret()).verify(body, headers));
		assert.throws(() => new Webhook(current).verify(`${body} `, headers));
	});
});
