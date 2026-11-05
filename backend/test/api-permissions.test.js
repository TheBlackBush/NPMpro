import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { newAdmin } from "./support/auth.js";

const TYPES = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"];
const LISTS = {
	proxy_hosts: "/nginx/proxy-hosts",
	redirection_hosts: "/nginx/redirection-hosts",
	dead_hosts: "/nginx/dead-hosts",
	streams: "/nginx/streams",
	access_lists: "/nginx/access-lists",
	certificates: "/nginx/certificates",
};
const allHidden = Object.fromEntries(TYPES.map((type) => [type, "hidden"]));
const host = {
	domain_names: ["perm.example.com"],
	forward_scheme: "http",
	forward_host: "10.0.0.1",
	forward_port: 8080,
};

let api;
let admin;
let hosts = 0;

const hostBody = () => {
	hosts += 1;
	return { ...host, domain_names: [`perm${hosts}.example.com`] };
};
const stored = (userId) => api.db("user_permission").where({ user_id: userId }).first();

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

it("sets the permissions of a user: the row is stored, the answer is true, the user sees them", async () => {
	const user = await api.limited({ visibility: "user" });
	const { id } = user.user;
	const set = await admin.put(`/users/${id}/permissions`, {
		visibility: "all",
		proxy_hosts: "manage",
		access_lists: "view",
		certificates: "view",
		streams: "view",
	});
	assert.equal(set.status, 200);
	assert.equal(set.body, true);
	const row = await stored(id);
	assert.equal(row.visibility, "all");
	assert.equal(row.proxy_hosts, "manage");
	assert.equal(row.access_lists, "view");
	assert.equal(row.certificates, "view");
	assert.equal(row.streams, "view");
	assert.equal(row.dead_hosts, "hidden");
	assert.equal(row.redirection_hosts, "hidden");
	const read = await admin.get(`/users/${id}?expand=permissions`);
	assert.equal(read.body.permissions.proxy_hosts, "manage");
	assert.equal((await user.get("/users/me?expand=permissions")).body.permissions.visibility, "all");
	const audit = await api.db("audit_log").where({ object_type: "user", object_id: id }).orderBy("id", "desc").first();
	assert.equal(JSON.parse(audit.meta).permissions.proxy_hosts, "manage");
});

it("changes only the fields that are sent", async () => {
	const user = await api.limited({
		visibility: "user",
		proxy_hosts: "view",
		access_lists: "view",
		certificates: "view",
	});
	const { id } = user.user;
	assert.equal(
		(await admin.put(`/users/${id}/permissions`, { streams: "view", certificates: "manage" })).status,
		200,
	);
	const row = await stored(id);
	assert.equal(row.streams, "view");
	assert.equal(row.certificates, "manage");
	assert.equal(row.proxy_hosts, "view");
	assert.equal(row.access_lists, "view");
	assert.equal(row.visibility, "user");
});

it("refuses hidden access lists while proxy hosts are visible, and hidden certificates while any host type is visible", async () => {
	const user = await api.limited({
		visibility: "user",
		proxy_hosts: "view",
		access_lists: "view",
		certificates: "view",
	});
	const { id } = user.user;
	const previous = await stored(id);
	// the rule counts the stored values together with the new ones
	const lists = await newAdmin(api, admin);
	const hiddenLists = await lists.put(`/users/${id}/permissions`, { access_lists: "hidden" });
	assert.equal(hiddenLists.status, 400);
	const certificates = await newAdmin(api, admin);
	const hiddenCertificates = await certificates.put(`/users/${id}/permissions`, { certificates: "hidden" });
	assert.equal(hiddenCertificates.status, 400);
	assert.deepEqual(await stored(id), previous);

	// a visible host type of any kind needs visible certificates
	for (const type of ["redirection_hosts", "dead_hosts", "streams", "proxy_hosts"]) {
		const other = await api.limited({ visibility: "user", ...allHidden });
		const session = await newAdmin(api, admin);
		const refused = await session.put(`/users/${other.user.id}/permissions`, {
			[type]: "view",
			access_lists: "view",
		});
		assert.equal(refused.status, 400, type);
		assert.equal((await stored(other.user.id))[type], "hidden", type);
	}

	// at once is fine: both sides of the rule in one request
	const fine = await api.limited({ visibility: "user", ...allHidden });
	const set = await admin.put(`/users/${fine.user.id}/permissions`, {
		proxy_hosts: "view",
		access_lists: "view",
		certificates: "view",
	});
	assert.equal(set.status, 200);
	// and hiding everything is fine
	const hide = await admin.put(`/users/${fine.user.id}/permissions`, allHidden);
	assert.equal(hide.status, 200);
	assert.equal((await stored(fine.user.id)).proxy_hosts, "hidden");
});

it("answers 400 for permissions that do not match the schema", async () => {
	const user = await api.limited({ visibility: "user" });
	const base = `/users/${user.user.id}/permissions`;
	const previous = await stored(user.user.id);
	const bodies = [
		{},
		{ proxy_hosts: "everything" },
		{ visibility: "some" },
		{ extra: "view" },
		{ streams: 1 },
		{ dead_hosts: null },
	];
	for (const body of bodies) {
		const session = await newAdmin(api, admin);
		assert.equal((await session.put(base, body)).status, 400, JSON.stringify(body));
	}
	assert.deepEqual(await stored(user.user.id), previous);
});

it("refuses setting permissions without a session (401), without the admin role (403, also for oneself), and for a user that is not there (404)", async () => {
	const user = await api.limited({ visibility: "user" });
	const other = await api.limited({ visibility: "user" });
	const previous = await stored(user.user.id);
	assert.equal((await api.client().put(`/users/${user.user.id}/permissions`, { visibility: "all" })).status, 401);
	assert.equal((await user.put(`/users/${other.user.id}/permissions`, { visibility: "all" })).status, 403);
	assert.equal((await user.put(`/users/${user.user.id}/permissions`, { visibility: "all" })).status, 403);
	assert.equal((await user.put("/users/me/permissions", { visibility: "all" })).status, 403);
	assert.deepEqual(await stored(user.user.id), previous);
	const session = await newAdmin(api, admin);
	assert.equal((await session.put("/users/999999/permissions", { visibility: "all" })).status, 404);
});

it("applies a permission change at once to a session that is already open", async () => {
	const user = await api.limited({ visibility: "user" });
	assert.equal((await user.get("/nginx/proxy-hosts")).status, 403);
	assert.equal(
		(
			await admin.put(`/users/${user.user.id}/permissions`, {
				proxy_hosts: "view",
				access_lists: "view",
				certificates: "view",
			})
		).status,
		200,
	);
	assert.equal((await user.get("/nginx/proxy-hosts")).status, 200);
	assert.equal((await admin.put(`/users/${user.user.id}/permissions`, allHidden)).status, 200);
	assert.equal((await user.get("/nginx/proxy-hosts")).status, 403);
});

const listTest = (type) =>
	it(`${type}: hidden refuses the list, view allows it, manage allows it`, async () => {
		const dependencies =
			type === "proxy_hosts" ? { access_lists: "view", certificates: "view" } : { certificates: "view" };
		const hiddenUser = await api.limited({ visibility: "user", ...allHidden });
		const hidden = await hiddenUser.get(LISTS[type]);
		assert.equal(hidden.status, 403);
		assert.equal(Array.isArray(hidden.body), false);
		const viewer = await api.limited({ visibility: "user", ...dependencies, [type]: "view" });
		const viewed = await viewer.get(LISTS[type]);
		assert.equal(viewed.status, 200);
		assert.ok(Array.isArray(viewed.body));
		const manager = await api.limited({ visibility: "user", ...dependencies, [type]: "manage" });
		assert.equal((await manager.get(LISTS[type])).status, 200);
		assert.equal((await api.client().get(LISTS[type])).status, 401);
	});

for (const type of TYPES) listTest(type);

it("proxy hosts: view cannot create, edit or delete, manage can, an administrator always can", async () => {
	const viewer = await api.limited({
		visibility: "user",
		proxy_hosts: "view",
		access_lists: "view",
		certificates: "view",
	});
	const manager = await api.limited({
		visibility: "user",
		proxy_hosts: "manage",
		access_lists: "view",
		certificates: "view",
	});
	const none = await api.limited({ visibility: "user", ...allHidden });
	const hostsBefore = (await api.db("proxy_host").count({ n: "*" }).first()).n;
	assert.equal((await viewer.post("/nginx/proxy-hosts", hostBody())).status, 403);
	assert.equal((await none.post("/nginx/proxy-hosts", hostBody())).status, 403);
	assert.equal((await api.db("proxy_host").count({ n: "*" }).first()).n, hostsBefore);

	const created = await manager.post("/nginx/proxy-hosts", hostBody());
	assert.equal(created.status, 201);
	assert.equal(created.body.owner_user_id, manager.user.id);
	const mine = await admin.post("/nginx/proxy-hosts", hostBody());
	assert.equal(mine.status, 201);
	assert.equal((await viewer.put(`/nginx/proxy-hosts/${mine.body.id}`, { forward_port: 9 })).status, 403);
	assert.equal((await viewer.delete(`/nginx/proxy-hosts/${mine.body.id}`)).status, 403);
	assert.equal((await api.db("proxy_host").where({ id: mine.body.id }).first()).forward_port, 8080);
});

it("visibility user shows only the own hosts, visibility all shows every host", async () => {
	const manager = await api.limited({
		visibility: "user",
		proxy_hosts: "manage",
		access_lists: "view",
		certificates: "view",
	});
	const theirs = await admin.post("/nginx/proxy-hosts", hostBody());
	const own = await manager.post("/nginx/proxy-hosts", hostBody());
	assert.equal(own.status, 201);
	const ids = (await manager.get("/nginx/proxy-hosts")).body.map((entry) => entry.id);
	assert.ok(ids.includes(own.body.id));
	assert.equal(ids.includes(theirs.body.id), false);
	const refused = await manager.get(`/nginx/proxy-hosts/${theirs.body.id}`);
	assert.ok([403, 404].includes(refused.status), `answered ${refused.status}`);
	assert.equal((await manager.put(`/nginx/proxy-hosts/${theirs.body.id}`, { forward_port: 9 })).status >= 400, true);
	assert.equal((await manager.delete(`/nginx/proxy-hosts/${theirs.body.id}`)).status >= 400, true);
	assert.ok(await api.db("proxy_host").where({ id: theirs.body.id }).first());

	assert.equal((await admin.put(`/users/${manager.user.id}/permissions`, { visibility: "all" })).status, 200);
	const all = (await manager.get("/nginx/proxy-hosts")).body.map((entry) => entry.id);
	assert.ok(all.includes(own.body.id));
	assert.ok(all.includes(theirs.body.id));
});

it("lets /auth through for any signed-in user and /auth/admin only for an administrator", async () => {
	const user = await api.limited({ visibility: "user" });
	assert.equal((await admin.get("/auth")).status, 200);
	assert.equal((await admin.get("/auth/admin")).status, 200);
	assert.equal((await user.get("/auth")).status, 200);
	const refused = await user.get("/auth/admin");
	assert.equal(refused.status, 403);
	assert.equal((await api.client().get("/auth")).status, 401);
	assert.equal((await api.client().get("/auth/admin")).status, 401);
	// a session that ended no longer passes
	assert.equal((await admin.put(`/users/${user.user.id}`, { is_disabled: true })).status, 200);
	assert.equal((await user.get("/auth")).status, 401);
});
