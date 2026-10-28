import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { BackupError } from "../lib/backup/format.js";
import { createScheduleRouter } from "../lib/express/backup-schedule-router.js";
import { getCompiledSchema } from "../schema/index.js";

await getCompiledSchema();

const access = { token: { getUserId: () => 1 } };
const service = {};
const router = createScheduleRouter({ service, auth: () => (_req, _res, next) => next() });

// runs the handler of a route directly, past the login middleware
const call = async (method, path, { params = {}, body, query = {} } = {}) => {
	const layer = router.stack.find((item) => item.route?.path === path);
	const handler = layer.route.stack.find((item) => item.method === method);
	const sent = {};
	const res = {
		locals: { access },
		status: (code) => {
			sent.status = code;
			return res;
		},
		send: (value) => {
			sent.body = value;
		},
	};
	try {
		await handler.handle({ params, body, query }, res);
	} catch (error) {
		sent.error = error;
	}
	return sent;
};

const calls = [];
const stub = (name, value) => {
	service[name] = (...args) => {
		calls.push([name, ...args.slice(1)]);
		return Promise.resolve(value);
	};
};

const valid = {
	name: "Nightly",
	frequency: "daily",
	time: "03:00",
	types: ["proxy_hosts"],
	protection: "none",
	keep: 3,
};

it("lists, creates, reads, updates, runs and deletes through the service", async () => {
	stub("list", [{ id: 1 }]);
	stub("create", { id: 2 });
	stub("get", { id: 3 });
	stub("update", { id: 3 });
	stub("runNow", { id: 3 });
	stub("remove", undefined);
	assert.deepEqual((await call("get", "/")).body, [{ id: 1 }]);
	assert.deepEqual((await call("post", "/", { body: valid })).body, { id: 2 });
	assert.deepEqual((await call("get", "/:id", { params: { id: "3" } })).body, { id: 3 });
	assert.deepEqual((await call("put", "/:id", { params: { id: "3" }, body: { keep: 5 } })).body, { id: 3 });
	assert.deepEqual((await call("post", "/:id/run", { params: { id: "3" } })).body, { id: 3 });
	calls.length = 0;
	assert.equal((await call("delete", "/:id", { params: { id: "3" }, query: { files: "true" } })).body, true);
	assert.deepEqual(calls, [["remove", 3, { files: true }]]);
	calls.length = 0;
	await call("delete", "/:id", { params: { id: "3" } });
	assert.deepEqual(calls, [["remove", 3, { files: false }]]);
});

it("refuses an id that is not a positive integer with a 400", async () => {
	for (const id of ["0", "abc", "-1", "1.5", "12345678901", "1e3"]) {
		for (const [method, path] of [
			["get", "/:id"],
			["put", "/:id"],
			["delete", "/:id"],
			["post", "/:id/run"],
		]) {
			const sent = await call(method, path, { params: { id }, body: { keep: 5 } });
			assert.equal(sent.error?.status, 400, `${method} ${path} ${id}`);
		}
	}
});

it("refuses numbers sent as strings or null with a 400 and the field's message id", async () => {
	for (const [field, code] of [
		["keep", "keep"],
		["every_hours", "every-hours"],
		["weekday", "weekday"],
		["month_day", "month-day"],
	]) {
		for (const value of ["3", null, true]) {
			const sent = await call("post", "/", { body: { ...valid, [field]: value } });
			assert.equal(sent.error?.status, 400, `${field} ${value}`);
			assert.equal(sent.error.message_i18n, `backup.schedule.error.${code}`);
			const put = await call("put", "/:id", { params: { id: "1" }, body: { [field]: value } });
			assert.equal(put.error?.status, 400, `put ${field} ${value}`);
		}
	}
	assert.equal((await call("post", "/", { body: { ...valid, keep: "3" } })).error.status, 400);
});

it("keeps spaces around a passphrase and refuses unknown or empty bodies", async () => {
	let received = null;
	service.create = (_access, payload) => {
		received = payload;
		return Promise.resolve({});
	};
	await call("post", "/", { body: { ...valid, protection: "passphrase", passphrase: "  twelve chars  " } });
	assert.equal(received.passphrase, "  twelve chars  ");
	assert.equal((await call("post", "/", { body: { ...valid, extra: 1 } })).error.status, 400);
	assert.equal((await call("put", "/:id", { params: { id: "1" }, body: {} })).error.status, 400);
	assert.equal((await call("post", "/", { body: { ...valid, types: [] } })).error.status, 400);
});

it("answers a busy delete with the service's 409", async () => {
	service.remove = () =>
		Promise.reject(Object.assign(new BackupError("busy", "A backup or restore is running"), { status: 409 }));
	const sent = await call("delete", "/:id", { params: { id: "1" }, query: { files: "true" } });
	assert.equal(sent.error.status, 409);
	assert.equal(sent.error.public, true);
	assert.equal(sent.error.message_i18n, "backup.error.busy");
});

it("mounts the schedule routes before the backup routes", async () => {
	const source = await readFile(new URL("../routes/main.js", import.meta.url), "utf8");
	const schedules = source.indexOf('router.use("/api/backups/schedules"');
	const backups = source.indexOf('router.use("/api/backups"');
	assert.ok(schedules > -1 && backups > -1 && schedules < backups);
	assert.equal(router.stack.find((item) => item.route?.path === "/").route.methods.get, true);
});
