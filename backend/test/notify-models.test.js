import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

let api;
let Delivery;
let State;

before(async () => {
	api = await startApi();
	Delivery = (await import("../models/notification_delivery.js")).default;
	State = (await import("../models/notification_state.js")).default;
});
after(() => api.stop());

const row = (extra = {}) => ({
	message_id: "msg_1",
	event: "cert_expiry",
	channel: "mail",
	status: "pending",
	payload: '{"secret":"x"}',
	...extra,
});

it("never shows the delivery payload in JSON, on an instance or a query result, but stores it", async () => {
	const inserted = await Delivery.query().insert(row());
	assert.equal("payload" in inserted.toJSON(), false);
	assert.equal(JSON.stringify(inserted).includes("secret"), false);

	const found = await Delivery.query().findById(inserted.id);
	assert.equal(found.payload, '{"secret":"x"}');
	assert.equal("payload" in found.toJSON(), false);
	assert.equal(JSON.stringify([found]).includes("secret"), false);
	assert.equal(found.toJSON().message_id, "msg_1");
	assert.ok(found.created_on);
	assert.ok(found.modified_on);
});

it("stores a 254 character recipient whole", async () => {
	const recipient = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
	assert.equal(recipient.length, 254);
	const inserted = await Delivery.query().insert(row({ recipient }));
	assert.equal((await Delivery.query().findById(inserted.id)).recipient, recipient);
});

it("keeps the state data as the text it was given", async () => {
	const inserted = await State.query().insert({
		key: "cert_expiry:1",
		event: "cert_expiry",
		object_id: "1",
		state: "soon",
		since: "2026-11-26 10:00:00",
		data: '{"days":3}',
	});
	assert.equal((await State.query().findById(inserted.id)).data, '{"days":3}');
});
