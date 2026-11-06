import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

// /audit-log (schema/paths/audit-log, wiki/Usage): every write through the API leaves a row an administrator can list,
// filter, page and open.

const BASE = "/audit-log";

let api;
let admin;
let writes = 0;

// a write through another router (proxy hosts), the way the other API tests make one
const writeHost = async (session = admin) => {
	writes += 1;
	const done = await session.post("/nginx/proxy-hosts", {
		domain_names: [`audit${writes}.example.com`],
		forward_scheme: "http",
		forward_host: `10.0.6.${writes}`,
		forward_port: 8080,
	});
	assert.equal(done.status, 201, done.text);
	return done.body;
};
const list = async (query = "") => {
	const done = await admin.get(`${BASE}${query}`);
	assert.equal(done.status, 200, done.text);
	return done;
};

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

it("lists a write made through another router, newest first, with the total in X-Total-Count", async () => {
	const host = await writeHost();
	const done = await list();
	const row = done.body.find((entry) => entry.object_type === "proxy-host" && entry.object_id === host.id);
	assert.ok(row, "the host creation is listed");
	assert.equal(row.action, "created");
	assert.equal(row.user_id, 1);
	assert.equal(row.meta.domain_names[0], host.domain_names[0]);
	assert.ok(row.created_on);
	assert.equal(Number(done.headers.get("x-total-count")), (await api.db("audit_log").count({ n: "*" }).first()).n);
	const ids = done.body.map((entry) => entry.id);
	assert.deepEqual(
		ids,
		[...ids].sort((a, b) => b - a),
	);
	assert.equal(done.body[0].id, row.id);
	assert.equal("user" in row, false);
});

it("leaves a row for an update, a disable, an enable and a delete, each with its action", async () => {
	const host = await writeHost();
	assert.equal((await admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 9090 })).status, 200);
	assert.equal((await admin.post(`/nginx/proxy-hosts/${host.id}/disable`)).status, 200);
	assert.equal((await admin.post(`/nginx/proxy-hosts/${host.id}/enable`)).status, 200);
	assert.equal((await admin.delete(`/nginx/proxy-hosts/${host.id}`)).status, 200);
	const rows = (await list("?object_type=proxy-host&limit=200")).body.filter((entry) => entry.object_id === host.id);
	assert.deepEqual(rows.map((entry) => entry.action).reverse(), [
		"created",
		"updated",
		"disabled",
		"enabled",
		"deleted",
	]);
});

it("expands the user of an entry", async () => {
	const plain = await list("?limit=1");
	assert.equal("user" in plain.body[0], false);
	const expanded = await list("?limit=1&expand=user");
	assert.equal(expanded.body[0].user.email, "admin@example.com");
	assert.equal("password" in expanded.body[0].user, false);
	assert.equal((await admin.get(`${BASE}?expand=owner`)).status, 400);
});

it("filters by object type, action and user, and searches the details", async () => {
	const host = await writeHost();
	const user = await admin.post("/users", {
		name: "Audit Subject",
		email: "audit-subject@example.com",
		roles: [],
		auth: { type: "password", secret: "correct-horse-battery-9" },
	});
	assert.equal(user.status, 201, user.text);

	const hosts = (await list("?object_type=proxy-host&limit=200")).body;
	assert.ok(hosts.length > 0);
	assert.ok(hosts.every((entry) => entry.object_type === "proxy-host"));
	const users = (await list("?object_type=user&action=created&limit=200")).body;
	assert.ok(users.some((entry) => entry.object_id === user.body.id));
	assert.ok(users.every((entry) => entry.object_type === "user" && entry.action === "created"));
	assert.equal((await list("?object_type=access-list")).body.length, 0);

	const byUser = (await list("?user_id=1&limit=200")).body;
	assert.ok(byUser.length > 0);
	assert.ok(byUser.every((entry) => entry.user_id === 1));
	assert.equal((await list("?user_id=999")).body.length, 0);

	const found = (await list(`?query=${encodeURIComponent(host.domain_names[0])}`)).body;
	assert.deepEqual(
		found.map((entry) => entry.object_id),
		[host.id],
	);
	const total = (await list(`?query=${encodeURIComponent("audit-subject@example.com")}`)).headers.get(
		"x-total-count",
	);
	assert.equal(Number(total) >= 1, true);
	assert.equal((await list("?query=no-such-text-anywhere")).headers.get("x-total-count"), "0");
});

it("lists the entries of manual backups unfiltered, with their own object type and actions", async () => {
	const made = await admin.post("/backups", { types: ["proxy_hosts"], secrets: false, keep: true });
	assert.equal(made.status, 200, made.text);
	const bytes = (await admin.get(`/backups/${made.body.entry.name}`)).bytes;
	const uploaded = await admin.send("POST", "/backups/upload", {
		form: bytes,
		headers: { "content-type": "application/octet-stream" },
	});
	assert.equal(uploaded.status, 200, uploaded.text);
	const rows = (await list("?limit=200")).body.filter((entry) => entry.object_type === "backup");
	assert.deepEqual(rows.map((entry) => entry.action).sort(), ["created", "uploaded"]);
});

it("filters the audit log by the backup entries", async () => {
	// restores, merges and page imports need a full backup run; their rows are written the way internal/backup.js does
	const now = new Date().toISOString().slice(0, 19).replace("T", " ");
	for (const [objectType, action] of [
		["backup", "restored"],
		["backup", "merged"],
		["proxy-host", "imported"],
	]) {
		await api.db("audit_log").insert({
			created_on: now,
			modified_on: now,
			user_id: 1,
			object_type: objectType,
			object_id: 0,
			action,
			meta: JSON.stringify({ name: "filter-test" }),
		});
	}
	const made = await admin.post("/backups", { types: ["proxy_hosts"], secrets: false, keep: true });
	assert.equal(made.status, 200, made.text);
	assert.equal((await admin.delete(`/backups/${made.body.entry.name}`)).status, 200);

	const byType = (await list("?object_type=backup&limit=200")).body;
	assert.deepEqual([...new Set(byType.map((entry) => entry.object_type))], ["backup"]);
	assert.deepEqual([...new Set(byType.map((entry) => entry.action))].sort(), [
		"created",
		"deleted",
		"merged",
		"restored",
		"uploaded",
	]);
	const expected = {
		created: "backup",
		deleted: "backup",
		uploaded: "backup",
		restored: "backup",
		merged: "backup",
		imported: "proxy-host",
	};
	for (const [action, objectType] of Object.entries(expected)) {
		const rows = (await list(`?action=${action}&limit=200`)).body;
		assert.ok(rows.length > 0, `${action} selects rows`);
		assert.ok(
			rows.every((entry) => entry.action === action),
			`${action} selects only its own rows`,
		);
		assert.ok(
			rows.some((entry) => entry.object_type === objectType),
			`${action} reaches a ${objectType} row`,
		);
	}
	const both = (await list("?object_type=backup&action=restored&limit=200")).body;
	assert.ok(both.length > 0);
	assert.ok(both.every((entry) => entry.object_type === "backup" && entry.action === "restored"));
	assert.equal((await admin.get(`${BASE}?object_type=backups`)).status, 400);
	assert.equal((await admin.get(`${BASE}?action=restore`)).status, 400);
});

it("pages with limit and offset, and the total counts every match", async () => {
	for (let n = 0; n < 4; n += 1) await writeHost();
	const all = (await list("?limit=200")).body;
	const total = Number((await list("?limit=1")).headers.get("x-total-count"));
	assert.equal(all.length, total);
	const first = await list("?limit=2");
	const second = await list("?limit=2&offset=2");
	assert.equal(first.body.length, 2);
	assert.deepEqual(
		[...first.body, ...second.body].map((entry) => entry.id),
		all.slice(0, 4).map((entry) => entry.id),
	);
	assert.equal(Number(second.headers.get("x-total-count")), total);
	assert.equal((await list(`?offset=${total}`)).body.length, 0);
	assert.equal((await list("")).body.length, Math.min(50, total));
});

it("refuses invalid filters with 400", async () => {
	for (const query of [
		"limit=0",
		"limit=201",
		"limit=abc",
		"limit=1.5",
		"offset=-1",
		"offset=abc",
		"object_type=nothing",
		"action=exploded",
		"user_id=0",
		"user_id=abc",
		"user_id=1.5",
		"expand=user,other",
	]) {
		const done = await admin.get(`${BASE}?${query}`);
		assert.equal(done.status, 400, `${query}: ${done.text}`);
	}
});

it("opens one entry with the user expanded, and answers 404 for an unknown one", async () => {
	const host = await writeHost();
	const row = (await list("?object_type=proxy-host&limit=1")).body[0];
	assert.equal(row.object_id, host.id);
	const one = await admin.get(`${BASE}/${row.id}`);
	assert.equal(one.status, 200, one.text);
	assert.equal(one.body.id, row.id);
	assert.equal(one.body.action, "created");
	assert.equal("user" in one.body, false);
	const expanded = await admin.get(`${BASE}/${row.id}?expand=user`);
	assert.equal(expanded.body.user.email, "admin@example.com");
	assert.equal((await admin.get(`${BASE}/9999999`)).status, 404);
	for (const id of ["0", "abc", "1.5", "-1"]) {
		assert.equal((await admin.get(`${BASE}/${id}`)).status, 400, id);
	}
	assert.equal((await admin.get(`${BASE}/${row.id}?expand=owner`)).status, 400);
});

it("records the writes of a user with limited rights under that user", async () => {
	const limited = await api.limited({
		visibility: "all",
		proxy_hosts: "manage",
		access_lists: "view",
		certificates: "view",
	});
	const host = await writeHost(limited);
	const row = (await list("?object_type=proxy-host&limit=1&expand=user")).body[0];
	assert.equal(row.object_id, host.id);
	assert.equal(row.user_id, limited.user.id);
	assert.equal(row.user.email, limited.user.email);
});

it("answers 401 without a session and 403 for a user who is not an administrator", async () => {
	const none = api.client();
	const limited = await api.limited({
		visibility: "all",
		proxy_hosts: "manage",
		access_lists: "view",
		certificates: "view",
	});
	const rows = (await list("?limit=1")).body;
	for (const url of [BASE, `${BASE}/${rows[0].id}`, `${BASE}?limit=1`]) {
		assert.equal((await none.get(url)).status, 401, url);
		const refused = await limited.get(url);
		assert.equal(refused.status, 403, url);
		assert.equal(refused.text.includes("example.com"), false, url);
	}
});
