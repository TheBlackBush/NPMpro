import assert from "node:assert/strict";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";

// Helpers and the shared tests of the four host types (proxy, redirection, dead hosts and streams). A test file starts
// its own API (startApi) and passes the live values through ctx: { api, admin }.

const EXPANDED_PERMISSIONS = { access_lists: "view", certificates: "view" };

const fileExists = (api, file) =>
	stat(path.join(api.root, file)).then(
		() => true,
		() => false,
	);
const listDir = async (api, dir) => (await readdir(path.join(api.root, dir))).sort();
const countRows = async (api, table) => Number((await api.db(table).count({ n: "*" }).first()).n);
const reloads = (api) => api.outside.control.reloads;

/**
 * A certificate row of the "other" (custom) provider with the file the host templates and the host checks look for
 *
 * @param   {Object}  api
 * @param   {Object}  [options]
 * @param   {String}  [options.provider]  "other" or "mtls"
 * @param   {String}  [options.domain]
 * @returns {Promise<Number>}  the certificate id
 */
const addCertificate = async (api, { provider = "other", domain = "cert.example.com" } = {}) => {
	const [id] = await api.db("certificate").insert({
		owner_user_id: 1,
		created_on: "2026-01-01 00:00:00",
		modified_on: "2026-01-01 00:00:00",
		provider,
		nice_name: `${provider} certificate`,
		domain_names: JSON.stringify([domain]),
		expires_on: "2099-01-01 00:00:00",
		meta: "{}",
	});
	if (provider === "mtls") {
		await mkdir(path.join(api.root, "data/tls/mtls"), { recursive: true });
		await writeFile(path.join(api.root, `data/tls/mtls/npm-${id}.pem`), "ca");
	} else {
		await mkdir(path.join(api.root, `data/tls/custom/npm-${id}`), { recursive: true });
		await writeFile(path.join(api.root, `data/tls/custom/npm-${id}/fullchain.pem`), "cert");
		await writeFile(path.join(api.root, `data/tls/custom/npm-${id}/privkey.pem`), "key");
	}
	return id;
};

/**
 * Asserts that an answer or a stored row holds every field of the body (JSON columns arrive as text from SQLite,
 * flags as 0 and 1)
 *
 * @param {Object} row
 * @param {Object} body
 */
const checkFields = (row, body) => {
	for (const [key, expected] of Object.entries(body)) {
		let actual = row[key];
		if (typeof actual === "string" && typeof expected === "object") actual = JSON.parse(actual);
		if (typeof expected === "boolean") actual = Boolean(actual);
		assert.deepEqual(actual, expected, key);
	}
};

/**
 * Asserts that a rendered nginx config is well formed: braces balance outside quoted strings and comments, and no
 * template text or "undefined" is left in it
 *
 * @param {String} text
 * @param {String} [label]
 */
const assertWellFormed = (text, label = "config") => {
	for (const leftover of ["{%", "%}", "{{", "}}", "undefined", "[object"]) {
		assert.equal(text.includes(leftover), false, `${label} still has "${leftover}"`);
	}
	let depth = 0;
	const bare = text.replace(/"(?:[^"\\\n]|\\.)*"/gu, '""').replace(/#.*$/gmu, "");
	for (const char of bare) {
		if (char === "{") depth += 1;
		if (char === "}") depth -= 1;
		assert.ok(depth >= 0, `${label} closes a block that is not open`);
	}
	assert.equal(depth, 0, `${label} leaves ${depth} block(s) open`);
};

/**
 * Reads a file under the API root; a host config (.conf, .conf.err) must be well formed
 *
 * @param   {Object}  api
 * @param   {String}  file
 * @returns {Promise<String>}
 */
const readConfig = async (api, file) => {
	const text = await api.read(file);
	if (/\.conf(\.err)?$/u.test(file)) assertWellFormed(text, file);
	return text;
};

const created = async (response, what) => {
	assert.equal(response.status, 201, `${what}: ${response.text}`);
	return response.body;
};

/**
 * Registers the tests every host type has.
 *
 * @param {Object}   ctx                  { api, admin }, set in the file's before()
 * @param {Object}   type
 * @param {String}   type.label           "proxy host"
 * @param {String}   type.path            "/nginx/proxy-hosts"
 * @param {String}   type.permission      "proxy_hosts"
 * @param {String}   type.dir             "data/nginx/proxy_host"
 * @param {String}   type.table           "proxy_host"
 * @param {Function} type.make            () => a new valid create body
 * @param {Function} type.written         (body) => RegExp that the rendered config of the body matches
 * @param {Function} type.edit            () => the body of a valid PUT
 * @param {Function} type.edited          (body, edit) => RegExp that the config matches after the edit
 * @param {Function} type.search          (body) => text the list search finds the host by
 * @param {Array}    type.invalid         [label, patch]: fields that make a valid body or edit invalid
 * @param {Object}   type.adminOnly       fields only an administrator may set
 * @param {Boolean}  [type.domains]       the type has domain names that must be unique across host types
 */
const hostTests = (ctx, type) => {
	// the values exist once the file's before() ran, after the tests are registered
	const api = new Proxy({}, { get: (_, key) => ctx.api[key] });
	const admin = new Proxy({}, { get: (_, key) => ctx.admin[key] });
	const URL = type.path;
	// the edit of one test, from type.edit() (a host type may need a new value each time)
	let edit;
	const tc = (name, options, fn) => {
		const run = fn ?? options;
		return it(name, fn ? options : {}, async (t) => {
			edit = type.edit();
			await run(t);
		});
	};
	const configOf = (id) => `${type.dir}/${id}.conf`;
	const make = () => type.make();
	const post = (who, body) => who.post(URL, body);
	const manager = () => api.limited({ visibility: "user", ...EXPANDED_PERMISSIONS, [type.permission]: "manage" });
	const viewer = (visibility = "all") =>
		api.limited({ visibility, ...EXPANDED_PERMISSIONS, [type.permission]: "view" });

	tc(`${type.label}: creates it, writes the config, reloads nginx once and logs it`, async () => {
		const body = make();
		const reloadsBefore = reloads(api);
		const answer = await admin.post(URL, body);
		assert.equal(answer.status, 201, answer.text);
		type.check(answer.body, body);
		assert.equal(answer.body.enabled, true);
		assert.equal(answer.body.owner_user_id, 1);
		assert.equal(answer.body.npmpro_nginx_online, true);
		assert.equal(answer.body.npmpro_nginx_err, "");
		const row = await api.db(type.table).where({ id: answer.body.id }).first();
		assert.ok(row, "the row is stored");
		assert.equal(row.enabled, 1);
		assert.equal(row.npmpro_nginx_online, 1);
		assert.match(await readConfig(api, configOf(answer.body.id)), type.written(body));
		assert.equal(await fileExists(api, `${configOf(answer.body.id)}.err`), false);
		assert.equal(reloads(api), reloadsBefore + 1);
		const audit = await api.db("audit_log").where({ object_id: answer.body.id, action: "created" }).first();
		assert.ok(audit, "an audit entry");
		assert.equal(audit.user_id, 1);
	});

	tc(`${type.label}: lists and reads it, with a search and an unknown expand answered by the schema`, async () => {
		const body = make();
		const host = await created(await admin.post(URL, body), "create");
		const one = await admin.get(`${URL}/${host.id}`);
		assert.equal(one.status, 200);
		assert.equal(one.body.id, host.id);
		type.check(one.body, body);
		const all = await admin.get(URL);
		assert.equal(all.status, 200);
		assert.ok(all.body.some((entry) => entry.id === host.id));
		const found = await admin.get(`${URL}?query=${encodeURIComponent(type.search(body))}`);
		assert.equal(found.status, 200);
		assert.ok(found.body.some((entry) => entry.id === host.id));
		assert.equal(
			found.body.every((entry) => entry.id !== undefined),
			true,
		);
		const none = await admin.get(`${URL}?query=no-such-host-anywhere`);
		assert.deepEqual(none.body, []);
		const owner = await admin.get(`${URL}?expand=owner`);
		assert.equal(owner.status, 200);
		assert.equal(owner.body.find((entry) => entry.id === host.id).owner.email, "admin@example.com");
		const unknown = await admin.get(`${URL}?expand=nothing`);
		assert.equal(unknown.status, 400);
	});

	tc(`${type.label}: edits it, rewrites the config and reloads nginx once`, async () => {
		const body = make();
		const host = await created(await admin.post(URL, body), "create");
		const reloadsBefore = reloads(api);
		const answer = await admin.put(`${URL}/${host.id}`, edit);
		assert.equal(answer.status, 200, answer.text);
		type.check(answer.body, { ...body, ...edit });
		type.check(await api.db(type.table).where({ id: host.id }).first(), { ...body, ...edit });
		assert.match(await readConfig(api, configOf(host.id)), type.edited(body, edit));
		assert.equal(reloads(api), reloadsBefore + 1);
		const audit = await api.db("audit_log").where({ object_id: host.id, action: "updated" }).first();
		assert.ok(audit);
	});

	tc(`${type.label}: refuses an invalid body with 400 and writes nothing`, async () => {
		const rows = await countRows(api, type.table);
		const files = await listDir(api, type.dir);
		const reloadsBefore = reloads(api);
		for (const [label, patch] of type.invalid) {
			const answer = await admin.post(URL, { ...make(), ...patch });
			assert.equal(answer.status, 400, `${label}: ${answer.text}`);
			assert.equal(typeof answer.body.error.message, "string", label);
		}
		const empty = await admin.post(URL, {});
		assert.equal(empty.status, 400);
		assert.equal(await countRows(api, type.table), rows);
		assert.deepEqual(await listDir(api, type.dir), files);
		assert.equal(reloads(api), reloadsBefore);
	});

	tc(`${type.label}: refuses an invalid edit with 400 and keeps the host and its config`, async () => {
		const body = make();
		const host = await created(await admin.post(URL, body), "create");
		const config = await readConfig(api, configOf(host.id));
		const reloadsBefore = reloads(api);
		for (const [label, patch] of type.invalid) {
			const answer = await admin.put(`${URL}/${host.id}`, { ...edit, ...patch });
			assert.equal(answer.status, 400, `${label}: ${answer.text}`);
		}
		assert.equal((await admin.put(`${URL}/${host.id}`, {})).status, 400);
		type.check(await api.db(type.table).where({ id: host.id }).first(), body);
		assert.equal(await readConfig(api, configOf(host.id)), config);
		assert.equal(reloads(api), reloadsBefore);
	});

	tc(`${type.label}: answers 401 on every route without a session`, async () => {
		const anonymous = api.client();
		const body = make();
		const host = await created(await admin.post(URL, body), "create");
		const rows = await countRows(api, type.table);
		const calls = [
			anonymous.get(URL),
			anonymous.post(URL, make()),
			anonymous.get(`${URL}/${host.id}`),
			anonymous.put(`${URL}/${host.id}`, edit),
			anonymous.delete(`${URL}/${host.id}`),
			anonymous.post(`${URL}/${host.id}/enable`),
			anonymous.post(`${URL}/${host.id}/disable`),
		];
		for (const answer of await Promise.all(calls)) {
			assert.equal(answer.status, 401);
			assert.equal(answer.body.error.message, "Invalid or expired token");
		}
		assert.equal(await countRows(api, type.table), rows);
		type.check(await api.db(type.table).where({ id: host.id }).first(), body);
		assert.equal((await api.db(type.table).where({ id: host.id }).first()).enabled, 1);
	});

	tc(`${type.label}: answers 403 on every route for a user without the permission`, async () => {
		const host = await created(await admin.post(URL, make()), "create");
		const hidden = await api.limited({ visibility: "all", ...EXPANDED_PERMISSIONS, [type.permission]: "hidden" });
		const rows = await countRows(api, type.table);
		const files = await listDir(api, type.dir);
		const reloadsBefore = reloads(api);
		const calls = [
			hidden.get(URL),
			hidden.get(`${URL}/${host.id}`),
			post(hidden, make()),
			hidden.put(`${URL}/${host.id}`, edit),
			hidden.delete(`${URL}/${host.id}`),
			hidden.post(`${URL}/${host.id}/enable`),
			hidden.post(`${URL}/${host.id}/disable`),
		];
		for (const answer of await Promise.all(calls)) {
			assert.equal(answer.status, 403);
			assert.equal(answer.body.error.message, "Permission Denied");
		}
		assert.equal(await countRows(api, type.table), rows);
		assert.deepEqual(await listDir(api, type.dir), files);
		assert.equal(reloads(api), reloadsBefore);
	});

	tc(
		`${type.label}: lets a user with view read, and refuses create, edit, delete, enable and disable with 403`,
		async () => {
			const body = make();
			const host = await created(await admin.post(URL, body), "create");
			const viewing = await viewer();
			assert.equal((await viewing.get(URL)).status, 200);
			const one = await viewing.get(`${URL}/${host.id}`);
			assert.equal(one.status, 200);
			assert.equal(one.body.id, host.id);
			const rows = await countRows(api, type.table);
			const files = await listDir(api, type.dir);
			const reloadsBefore = reloads(api);
			const refused = [
				await post(viewing, make()),
				await viewing.put(`${URL}/${host.id}`, edit),
				await viewing.delete(`${URL}/${host.id}`),
				await viewing.post(`${URL}/${host.id}/disable`),
				await viewing.post(`${URL}/${host.id}/enable`),
			];
			for (const answer of refused) assert.equal(answer.status, 403, answer.text);
			assert.equal(await countRows(api, type.table), rows);
			assert.deepEqual(await listDir(api, type.dir), files);
			assert.equal(reloads(api), reloadsBefore);
			const row = await api.db(type.table).where({ id: host.id }).first();
			type.check(row, body);
			assert.equal(row.enabled, 1);
		},
	);

	tc(`${type.label}: a user with manage creates, edits and deletes the own host`, async () => {
		const managing = await manager();
		const body = make();
		const host = await created(await post(managing, body), "create");
		assert.equal(host.owner_user_id, managing.user.id);
		assert.match(await readConfig(api, configOf(host.id)), type.written(body));
		const saved = await managing.put(`${URL}/${host.id}`, edit);
		assert.equal(saved.status, 200, saved.text);
		assert.match(await readConfig(api, configOf(host.id)), type.edited(body, edit));
		const removed = await managing.delete(`${URL}/${host.id}`);
		assert.equal(removed.status, 200);
		assert.equal(await api.db(type.table).where({ id: host.id }).first(), undefined);
		assert.equal(await fileExists(api, configOf(host.id)), false);
	});

	tc(`${type.label}: refuses the raw nginx config to a user with manage, on create and on edit`, async () => {
		const managing = await manager();
		const rows = await countRows(api, type.table);
		const files = await listDir(api, type.dir);
		const attempt = await post(managing, { ...make(), ...type.adminOnly });
		assert.equal(attempt.status, 403, attempt.text);
		assert.equal(attempt.body.error.message_i18n, "error.advanced-config-admin-only");
		assert.equal(await countRows(api, type.table), rows);
		assert.deepEqual(await listDir(api, type.dir), files);
		const own = await created(await post(managing, make()), "create");
		const refusedEdit = await managing.put(`${URL}/${own.id}`, type.adminOnly);
		assert.equal(refusedEdit.status, 403, refusedEdit.text);
		const stored = await api.db(type.table).where({ id: own.id }).first();
		for (const field of Object.keys(type.adminOnly)) assert.notEqual(stored[field], type.adminOnly[field]);
		// an administrator may set it
		const allowed = await admin.put(`${URL}/${own.id}`, type.adminOnly);
		assert.equal(allowed.status, 200, allowed.text);
		for (const field of Object.keys(type.adminOnly)) assert.equal(allowed.body[field], type.adminOnly[field]);
	});

	tc(`${type.label}: disable removes the config and enable writes it again, each with one reload`, async () => {
		const body = make();
		const host = await created(await admin.post(URL, body), "create");
		const reloadsBefore = reloads(api);
		const off = await admin.post(`${URL}/${host.id}/disable`);
		assert.equal(off.status, 200, off.text);
		assert.equal(off.body.enabled, false);
		assert.equal((await api.db(type.table).where({ id: host.id }).first()).enabled, 0);
		assert.equal(await fileExists(api, configOf(host.id)), false);
		assert.equal(reloads(api), reloadsBefore + 1);
		const again = await admin.post(`${URL}/${host.id}/disable`);
		assert.equal(again.status, 400);
		assert.match(again.body.error.message, /already disabled/u);
		const on = await admin.post(`${URL}/${host.id}/enable`);
		assert.equal(on.status, 200, on.text);
		assert.equal(on.body.enabled, true);
		assert.equal((await api.db(type.table).where({ id: host.id }).first()).enabled, 1);
		assert.match(await readConfig(api, configOf(host.id)), type.written(body));
		assert.equal(reloads(api), reloadsBefore + 2);
		const twice = await admin.post(`${URL}/${host.id}/enable`);
		assert.equal(twice.status, 400);
		assert.match(twice.body.error.message, /already enabled/u);
		for (const action of ["disable", "enable"]) {
			assert.ok(
				await api
					.db("audit_log")
					.where({ object_id: host.id, action: `${action}d` })
					.first(),
				action,
			);
		}
	});

	tc(`${type.label}: a disabled host keeps its edits and gets no config until it is enabled`, async () => {
		const body = make();
		const host = await created(await admin.post(URL, body), "create");
		assert.equal((await admin.post(`${URL}/${host.id}/disable`)).status, 200);
		const reloadsBefore = reloads(api);
		const saved = await admin.put(`${URL}/${host.id}`, edit);
		assert.equal(saved.status, 200, saved.text);
		assert.equal(await fileExists(api, configOf(host.id)), false);
		assert.equal(reloads(api), reloadsBefore);
		assert.equal((await admin.post(`${URL}/${host.id}/enable`)).status, 200);
		assert.match(await readConfig(api, configOf(host.id)), type.edited(body, edit));
	});

	tc(`${type.label}: delete removes the row and the config, reloads once and logs it`, async () => {
		const host = await created(await admin.post(URL, make()), "create");
		const reloadsBefore = reloads(api);
		const removed = await admin.delete(`${URL}/${host.id}`);
		assert.equal(removed.status, 200, removed.text);
		assert.equal(removed.body.id, host.id);
		assert.equal(await api.db(type.table).where({ id: host.id }).first(), undefined);
		assert.equal(await fileExists(api, configOf(host.id)), false);
		assert.equal(reloads(api), reloadsBefore + 1);
		assert.equal((await admin.get(`${URL}/${host.id}`)).status, 404);
		assert.equal((await admin.delete(`${URL}/${host.id}`)).status, 404);
		const audit = await api.db("audit_log").where({ object_id: host.id, action: "deleted" }).first();
		assert.ok(audit);
		// a host that was disabled has no config to remove, the delete still works
		const off = await created(await admin.post(URL, make()), "create");
		assert.equal((await admin.post(`${URL}/${off.id}/disable`)).status, 200);
		assert.equal((await admin.delete(`${URL}/${off.id}`)).status, 200);
		assert.equal(await api.db(type.table).where({ id: off.id }).first(), undefined);
	});

	tc(`${type.label}: delete also removes the error copy of a config nginx refused`, async () => {
		api.outside.control.failNext = "nginx: [emerg] refused";
		const host = await created(await admin.post(URL, make()), "create");
		assert.equal(await fileExists(api, `${configOf(host.id)}.err`), true);
		assert.equal((await admin.delete(`${URL}/${host.id}`)).status, 200);
		assert.equal(await fileExists(api, `${configOf(host.id)}.err`), false);
		assert.equal(await fileExists(api, configOf(host.id)), false);
	});

	tc(`${type.label}: a user with visibility user sees, edits and deletes only the own hosts`, async () => {
		const managing = await manager();
		const theirs = await created(await admin.post(URL, make()), "create");
		const own = await created(await post(managing, make()), "create");
		const ids = (await managing.get(URL)).body.map((entry) => entry.id);
		assert.ok(ids.includes(own.id));
		assert.equal(ids.includes(theirs.id), false);
		const config = await readConfig(api, configOf(theirs.id));
		const reloadsBefore = reloads(api);
		const refused = [
			await managing.get(`${URL}/${theirs.id}`),
			await managing.put(`${URL}/${theirs.id}`, edit),
			await managing.delete(`${URL}/${theirs.id}`),
			await managing.post(`${URL}/${theirs.id}/disable`),
			await managing.post(`${URL}/${theirs.id}/enable`),
		];
		for (const answer of refused) {
			assert.equal(answer.status, 404, answer.text);
			assert.equal(answer.body.error.message, `Not Found - ${theirs.id}`);
		}
		const row = await api.db(type.table).where({ id: theirs.id }).first();
		assert.equal(row.enabled, 1);
		assert.equal(await readConfig(api, configOf(theirs.id)), config);
		assert.equal(reloads(api), reloadsBefore);
		assert.equal((await admin.put(`/users/${managing.user.id}/permissions`, { visibility: "all" })).status, 200);
		const all = (await managing.get(URL)).body.map((entry) => entry.id);
		assert.ok(all.includes(own.id));
		assert.ok(all.includes(theirs.id));
		assert.equal((await managing.get(`${URL}/${theirs.id}`)).status, 200);
		// a view-only user with visibility user sees none of the administrator's hosts either
		const narrow = await viewer("user");
		assert.deepEqual((await narrow.get(URL)).body, []);
	});

	tc(
		`${type.label}: a reload nginx refuses is kept as an error on the host, and a later good save recovers`,
		async () => {
			const message = "nginx: [emerg] unexpected end of file in /data/nginx/test";
			api.outside.control.failNext = message;
			const reloadsBefore = reloads(api);
			const body = make();
			const answer = await admin.post(URL, body);
			assert.equal(answer.status, 201, answer.text);
			assert.equal(answer.body.npmpro_nginx_online, false);
			assert.equal(answer.body.npmpro_nginx_err, message);
			const id = answer.body.id;
			const row = await api.db(type.table).where({ id }).first();
			assert.equal(row.npmpro_nginx_online, 0);
			assert.equal(row.npmpro_nginx_err, message);
			assert.equal(await fileExists(api, configOf(id)), false);
			assert.match(await readConfig(api, `${configOf(id)}.err`), type.written(body));
			// the refused config, then the reload without it
			assert.equal(reloads(api), reloadsBefore + 2);
			const fixed = await admin.put(`${URL}/${id}`, edit);
			assert.equal(fixed.status, 200, fixed.text);
			assert.equal(fixed.body.npmpro_nginx_online, true);
			assert.equal(fixed.body.npmpro_nginx_err, "");
			const healthy = await api.db(type.table).where({ id }).first();
			assert.equal(healthy.npmpro_nginx_online, 1);
			assert.equal(healthy.npmpro_nginx_err, "");
			assert.match(await readConfig(api, configOf(id)), type.edited(body, edit));
			assert.equal(await fileExists(api, `${configOf(id)}.err`), false);
		},
	);

	tc(`${type.label}: a reload nginx refuses on enable keeps the error and the .err config`, async () => {
		const body = make();
		const host = await created(await admin.post(URL, body), "create");
		assert.equal((await admin.post(`${URL}/${host.id}/disable`)).status, 200);
		api.outside.control.failNext = "nginx: [emerg] bad value";
		const answer = await admin.post(`${URL}/${host.id}/enable`);
		assert.equal(answer.status, 200, answer.text);
		assert.equal(answer.body.npmpro_nginx_online, false);
		assert.equal(answer.body.npmpro_nginx_err, "nginx: [emerg] bad value");
		assert.equal(answer.body.enabled, true);
		assert.equal(await fileExists(api, configOf(host.id)), false);
		assert.equal(await fileExists(api, `${configOf(host.id)}.err`), true);
	});

	tc(`${type.label}: answers GET with an id below 1 or that is no integer with 400`, async () => {
		for (const id of ["0", "-1", "abc", "1.5", "1abc"]) {
			const answer = await admin.get(`${URL}/${id}`);
			assert.equal(answer.status, 400, id);
		}
	});

	tc(
		`${type.label}: answers PUT, DELETE, enable and disable with an id below 1 or text with 400`,
		{
		},
		async () => {
			const calls = (id) => [
				["PUT", () => admin.put(`${URL}/${id}`, edit)],
				["DELETE", () => admin.delete(`${URL}/${id}`)],
				["enable", () => admin.post(`${URL}/${id}/enable`)],
				["disable", () => admin.post(`${URL}/${id}/disable`)],
			];
			for (const id of ["0", "-1", "abc"]) {
				for (const [method, call] of calls(id)) {
					const answer = await call();
					assert.equal(answer.status, 400, `${method} ${id}: ${answer.status}`);
				}
			}
		},
	);

	tc(
		`${type.label}: does not act on host N for PUT, DELETE, enable or disable with the id N.5 or Nabc`,
		{
		},
		async () => {
			for (const suffix of [".5", "abc"]) {
				const host = await created(await admin.post(URL, make()), "create");
				const id = `${host.id}${suffix}`;
				const answers = [
					await admin.put(`${URL}/${id}`, edit),
					await admin.post(`${URL}/${id}/disable`),
					await admin.post(`${URL}/${id}/enable`),
					await admin.delete(`${URL}/${id}`),
				];
				const row = await api.db(type.table).where({ id: host.id }).first();
				assert.deepEqual(
					answers.map(({ status }) => status),
					[400, 400, 400, 400],
					suffix,
				);
				assert.ok(row, `the host is still stored (${suffix})`);
			}
		},
	);
};

export {
	addCertificate,
	assertWellFormed,
	checkFields,
	countRows,
	created,
	fileExists,
	hostTests,
	listDir,
	readConfig,
	reloads,
};
