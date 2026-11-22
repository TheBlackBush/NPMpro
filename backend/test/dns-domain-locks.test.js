import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { ownerLock, withAllOwnerLocks } from "../lib/dns-domain-lock.js";
import { startApi } from "./support/api.js";

// The owner lock of the DNS domains against the real routes: a request that waited for the lock reads its rows again,
// and a backup restore holds the locks of every owner. The test holds the admin's lock itself (the app runs in this
// process), lets the requests queue behind it and changes the database meanwhile.

const TOKEN = "cf-token-SECRET-locks-1234567890";
// long enough for a request to read its row and reach the lock on a busy machine; the outcome is the same either way
const QUEUE_WAIT_MS = 300;

let api;
let admin;
let adminId;
let credentials = 0;

const credential = async (domains = []) => {
	credentials += 1;
	const done = await admin.post("/nginx/dns-credentials", {
		name: `Lock credential ${credentials}`,
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: TOKEN }],
		domains,
	});
	if (done.status !== 201) throw new Error(`credential create answered ${done.status}: ${done.text}`);
	return done.body;
};

/** holds the admin's owner lock until the returned function is called */
const holdAdminLock = () => {
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	void ownerLock(adminId, () => held);
	return release;
};

before(async () => {
	api = await startApi();
	admin = await api.admin();
	adminId = (await admin.get("/users/me")).body.id;
});
after(() => api?.stop());

it("a credential save that waited for the lock while the credential was deleted answers 404, not 500", async () => {
	const c = await credential(["lock-save.example"]);
	const release = holdAdminLock();
	const save = admin.put(`/nginx/dns-credentials/${c.id}`, { domains: ["lock-save.example", "lock-new.example"] });
	await sleep(QUEUE_WAIT_MS);
	await api.db("npmpro_dns_domain").where({ dns_credential_id: c.id }).del();
	await api.db("npmpro_dns_credential").where({ id: c.id }).del();
	release();
	const answer = await save;
	assert.equal(answer.status, 404, answer.text);
	assert.deepEqual(await api.db("npmpro_dns_domain").where({ dns_credential_id: c.id }), []);
	const audit = await api
		.db("audit_log")
		.where({ object_type: "dns-credential", action: "updated", object_id: c.id });
	assert.deepEqual(audit, []);
});

it("a second delete of a credential that waited for the lock answers 404 and logs nothing", async () => {
	const c = await credential(["lock-twice.example"]);
	const release = holdAdminLock();
	const first = admin.delete(`/nginx/dns-credentials/${c.id}`);
	const second = admin.delete(`/nginx/dns-credentials/${c.id}`);
	await sleep(QUEUE_WAIT_MS);
	release();
	const statuses = (await Promise.all([first, second])).map((answer) => answer.status).sort();
	assert.deepEqual(statuses, [200, 404]);
	const audit = await api
		.db("audit_log")
		.where({ object_type: "dns-credential", action: "deleted", object_id: c.id });
	assert.equal(audit.length, 1);
});

it("a domain delete that waited for the lock while the domain went answers 404 and logs nothing", async () => {
	const c = await credential(["lock-gone.example"]);
	const [domain] = await api.db("npmpro_dns_domain").where({ dns_credential_id: c.id });
	const release = holdAdminLock();
	const removal = admin.delete(`/nginx/dns-domains/${domain.id}`);
	await sleep(QUEUE_WAIT_MS);
	await api.db("npmpro_dns_domain").where({ id: domain.id }).del();
	release();
	const answer = await removal;
	assert.equal(answer.status, 404, answer.text);
	const audit = await api
		.db("audit_log")
		.where({ object_type: "dns-domain", action: "deleted", object_id: domain.id });
	assert.deepEqual(audit, []);
});

it("a restore holds every owner's lock: a domain save waits for it, and it waits for a save", async () => {
	const order = [];
	const release = holdAdminLock();
	const restore = withAllOwnerLocks(api.db, () => order.push("restore"));
	await sleep(QUEUE_WAIT_MS);
	assert.deepEqual(order, [], "the restore waits for the save that holds the lock");
	release();
	await restore;
	// the queued save goes out in an object: awaiting it inside the restore would wait for the restore's own lock
	const { queued } = await withAllOwnerLocks(api.db, async () => {
		const save = ownerLock(adminId, () => order.push("save"));
		await sleep(QUEUE_WAIT_MS);
		order.push("restore done");
		return { queued: save };
	});
	await queued;
	assert.deepEqual(order, ["restore", "restore done", "save"]);
});

it("a backup restore of DNS credentials waits for a domain save of the admin", async () => {
	await credential(["lock-backup.example"]);
	const made = await admin.post("/backups", { types: ["dns_credentials"], secrets: false, keep: true });
	assert.equal(made.status, 200, made.text);
	const inspected = await admin.post(`/backups/${made.body.entry.name}/inspect`, {});
	assert.equal(inspected.status, 200, inspected.text);
	const release = holdAdminLock();
	let finished = false;
	const restore = admin
		.post(`/backups/restore/${inspected.body.token}`, { types: ["dns_credentials"], confirm: true })
		.then((answer) => {
			finished = true;
			return answer;
		});
	await sleep(QUEUE_WAIT_MS * 2);
	assert.equal(finished, false, "the restore finished while a domain save held the admin's lock");
	release();
	const answer = await restore;
	assert.equal(answer.status, 200, answer.text);
});
