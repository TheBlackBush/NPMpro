import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import net from "node:net";
import { after, before, it } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { startApi } from "./support/api.js";
import { fileExists, listDir } from "./support/hosts.js";

// /database* (schema/paths/database, wiki/Database): the status, the test of a target and the refusals of a move. A
// move that succeeds ends the process, so it stays with database-move.test.js.

const BASE = "/database";
const PASSWORD = "  pw with spaces and SECRET  ";

let api;
let admin;

const mysql = (port, overrides = {}) => ({
	engine: "mysql",
	host: "127.0.0.1",
	port,
	name: "npmpro",
	user: "npmpro",
	password: PASSWORD,
	...overrides,
});
// a TCP server that accepts a connection and never speaks, so a target test on it waits
const silentServer = async () => {
	const sockets = [];
	let accepted;
	const first = new Promise((resolve) => {
		accepted = resolve;
	});
	const server = net.createServer((socket) => {
		sockets.push(socket);
		accepted();
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		port: server.address().port,
		first,
		hangUp: () => {
			for (const socket of sockets) socket.destroy();
		},
		close: () => new Promise((resolve) => server.close(resolve)),
	};
};

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

it("shows the database in use: engine, file, version, size, source and the rows of every table", async () => {
	await admin.post("/nginx/proxy-hosts", {
		domain_names: ["db.example.com"],
		forward_scheme: "http",
		forward_host: "10.0.10.1",
		forward_port: 80,
	});
	const done = await admin.get(BASE);
	assert.equal(done.status, 200, done.text);
	assert.equal(done.body.engine, "sqlite");
	assert.equal(done.body.file, `${api.root}/data/npmpro/database.sqlite`);
	assert.match(done.body.version, /^\d+\.\d+/u);
	assert.equal(done.body.source, "default");
	assert.ok(done.body.size > 0);
	assert.equal(done.body.moved_at, null);
	assert.equal(done.body.moved_from, null);
	assert.equal(done.body.move, null);
	const rows = Object.fromEntries(done.body.tables.map((table) => [table.name, table.rows]));
	assert.equal(rows.proxy_host, 1);
	assert.equal(rows.user, 1);
	assert.equal(rows.setting, 1);
	for (const table of ["access_list", "certificate", "stream", "traffic_minute", "npmpro_backup_schedule"]) {
		assert.ok(table in rows, table);
	}
	assert.equal("password" in done.body, false);
});

it("shows no move before one has started", async () => {
	const done = await admin.get(`${BASE}/move`);
	assert.equal(done.status, 200);
	assert.deepEqual(done.body, { move: null });
});

it("tests a SQLite target without a connection", async () => {
	const done = await admin.post(`${BASE}/test`, { engine: "sqlite" });
	assert.equal(done.status, 200, done.text);
	assert.deepEqual(done.body, { engine: "sqlite", version: null, flavor: null });
	// a test creates nothing: no other database file
	const names = await listDir(api, "data/npmpro");
	assert.deepEqual(
		names.filter((name) => name.startsWith("database-")),
		[],
	);
	assert.ok(names.includes("database.sqlite"));
});

it("answers a target that can not be reached with 400, and never shows the password", async () => {
	for (const target of [mysql(1), mysql(1, { engine: "postgres" })]) {
		const done = await admin.post(`${BASE}/test`, target);
		assert.equal(done.status, 400, done.text);
		assert.equal(done.body.error.message, "Could not connect to the target database");
		assert.equal(done.body.error.message_i18n, "database.error.connect");
		assert.equal(done.text.includes("SECRET"), false);
	}
});

it("refuses unknown fields, engines, ports and types on a test and on a move, and starts nothing", async () => {
	const base = mysql(3306, { host: "127.0.0.1" });
	const bodies = [
		{},
		{ ...base, extra: 1 },
		{ ...base, engine: "oracle" },
		{ ...base, port: 70000 },
		{ ...base, port: 0 },
		{ ...base, port: "3306" },
		{ ...base, port: 3306.5 },
		{ ...base, name: 5 },
		{ ...base, host: ["db"] },
		{ ...base, ssl: { enabled: "true" } },
		{ ...base, ssl: { enabled: 1 } },
		{ ...base, ssl: { enabled: false, other: true } },
		{ ...base, password: 12 },
		{ ...base, name: "x".repeat(65) },
		{ engine: "mysql", port: 3306 },
		{ host: "db.lan" },
	];
	for (const body of bodies) {
		for (const path of [`${BASE}/test`, `${BASE}/move`]) {
			const done = await admin.post(path, body);
			assert.equal(done.status, 400, `${path} ${JSON.stringify(body)}: ${done.text}`);
			// a refusal by the checks, never a try to connect
			assert.notEqual(done.body.error.message_i18n, "database.error.connect", `${path} ${JSON.stringify(body)}`);
		}
	}
	// a value of another type is not turned into the right one: "3306" stays text and is refused as such
	for (const body of [
		{ ...base, port: "3306" },
		{ ...base, name: 5 },
		{ ...base, ssl: { enabled: 1 } },
		{ ...base, password: 12 },
	]) {
		const done = await admin.post(`${BASE}/test`, body);
		assert.match(done.body.error.message, /has the wrong type/u, JSON.stringify(body));
	}
	assert.deepEqual((await admin.get(`${BASE}/move`)).body, { move: null });
	assert.equal((await admin.get(BASE)).body.moved_at, null);
});

it("refuses a move to a target that does not answer, writes no connection file and leaves the database in use", async () => {
	const done = await admin.post(`${BASE}/move`, mysql(1));
	assert.equal(done.status, 400, done.text);
	assert.equal(done.body.error.message_i18n, "database.error.connect");
	assert.equal(await fileExists(api, "data/npmpro/database.json"), false);
	assert.deepEqual((await admin.get(`${BASE}/move`)).body, { move: null });
	assert.equal((await admin.get(BASE)).body.engine, "sqlite");
	assert.equal((await admin.get("/users/me")).status, 200);
});

it("refuses a second move and a test while a move is being started", async () => {
	const target = await silentServer();
	try {
		const first = admin.post(`${BASE}/move`, mysql(target.port));
		await target.first;
		const second = await admin.post(`${BASE}/move`, mysql(target.port));
		assert.equal(second.status, 409, second.text);
		assert.equal(second.body.error.message_i18n, "database.error.move-running");
		const tested = await admin.post(`${BASE}/test`, mysql(target.port));
		assert.equal(tested.status, 409, tested.text);
		assert.equal(tested.body.error.message_i18n, "database.error.move-running");
		target.hangUp();
		const ended = await first;
		assert.equal(ended.status, 400, ended.text);
		assert.equal(ended.body.error.message_i18n, "database.error.connect");
	} finally {
		target.hangUp();
		await target.close();
	}
	// the refusal is over with the failed start: a new test is answered again
	assert.equal((await admin.post(`${BASE}/test`, { engine: "sqlite" })).status, 200);
});

it("refuses a move while a backup or restore holds the lock, and starts nothing", async () => {
	await admin.post("/nginx/proxy-hosts", {
		domain_names: ["lock.example.com"],
		forward_scheme: "http",
		forward_host: "10.0.10.2",
		forward_port: 80,
	});
	const kept = await admin.post("/backups", { types: ["proxy_hosts"], secrets: false, keep: true });
	const opened = await admin.post(`/backups/${kept.body.entry.name}/inspect`, {});
	assert.equal(opened.status, 200, opened.text);
	await api.outside.hookCommand(
		"nginx",
		`#!/bin/sh\ntouch "${api.root}/fake/nginx-called"\nwhile [ ! -f "${api.root}/fake/nginx-release" ]; do sleep 0.05; done\nexit 0\n`,
	);
	const restore = admin.post(`/backups/restore/${opened.body.token}`, { types: ["proxy_hosts"], confirm: true });
	try {
		for (let attempt = 0; attempt < 200 && !(await fileExists(api, "fake/nginx-called")); attempt += 1)
			await wait(25);
		assert.equal(await fileExists(api, "fake/nginx-called"), true, "the restore reached nginx -t");
		const refused = await admin.post(`${BASE}/move`, { engine: "sqlite" });
		assert.equal(refused.status, 409, refused.text);
		assert.equal(refused.body.error.message_i18n, "backup.error.busy");
		assert.deepEqual((await admin.get(`${BASE}/move`)).body, { move: null });
	} finally {
		await api.outside.hookCommand("nginx", "#!/bin/sh\nexit 0\n");
		await writeFile(`${api.root}/fake/nginx-release`, "");
	}
	assert.equal((await restore).status, 200);
});

it("answers 401 without a session on every database route", async () => {
	const none = api.client();
	for (const [method, url, body] of [
		["get", BASE],
		["get", `${BASE}/move`],
		["post", `${BASE}/test`, { engine: "sqlite" }],
		["post", `${BASE}/move`, { engine: "sqlite" }],
	]) {
		assert.equal((await none[method](url, body)).status, 401, `${method} ${url}`);
	}
});

it("gives a user who is not an administrator 403 on every database route, and starts nothing", async () => {
	const users = [
		await api.limited({ visibility: "all", proxy_hosts: "manage", access_lists: "view", certificates: "view" }),
		await api.limited({ visibility: "user" }),
	];
	for (const user of users) {
		for (const [method, url, body] of [
			["get", BASE],
			["get", `${BASE}/move`],
			["post", `${BASE}/test`, { engine: "sqlite" }],
			["post", `${BASE}/move`, { engine: "sqlite" }],
		]) {
			const done = await user[method](url, body);
			assert.equal(done.status, 403, `${method} ${url}`);
		}
	}
	assert.deepEqual((await admin.get(`${BASE}/move`)).body, { move: null });
	assert.equal((await admin.get(BASE)).body.moved_at, null);
});
