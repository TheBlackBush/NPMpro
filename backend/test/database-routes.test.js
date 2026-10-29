import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { it } from "node:test";
import { createMaintenance } from "../lib/database/maintenance.js";
import { createDatabaseRouter } from "../lib/express/database-router.js";
import { getCompiledSchema } from "../schema/index.js";

await getCompiledSchema();

const access = { token: { getUserId: () => 1 } };
const service = {};
const router = createDatabaseRouter({ service, auth: () => (_req, _res, next) => next() });

const call = async (method, path, { body, res: given } = {}) => {
	const layer = router.stack.find((item) => item.route?.path === path);
	const handler = layer.route.stack.find((item) => item.method === method);
	const sent = {};
	const res = given ?? new EventEmitter();
	res.locals = { access };
	res.status = (code) => {
		sent.status = code;
		return res;
	};
	res.send = (value) => {
		sent.body = value;
	};
	try {
		await handler.handle({ body, params: {}, query: {} }, res);
	} catch (error) {
		sent.error = error;
	}
	return sent;
};

const calls = [];
for (const name of ["status", "test", "move", "progress"]) {
	service[name] = (...args) => {
		calls.push([name, ...args.slice(1)]);
		return Promise.resolve({ name });
	};
}

const target = {
	engine: "postgres",
	host: " db.lan ",
	port: 5432,
	name: "npmpro",
	user: "npmpro",
	password: "  spaces kept  ",
	ssl: { enabled: false },
};

it("passes reads and checked bodies to the service, the password as typed", async () => {
	assert.deepEqual(await call("get", "/"), { status: 200, body: { name: "status" } });
	assert.deepEqual(await call("get", "/move"), { status: 200, body: { name: "progress" } });
	assert.equal((await call("post", "/test", { body: target })).status, 200);
	assert.equal((await call("post", "/move", { body: { engine: "sqlite" } })).status, 200);
	const [, tested] = calls.find(([name]) => name === "test");
	assert.equal(tested.host, "db.lan");
	assert.equal(tested.password, "  spaces kept  ");
	assert.deepEqual(calls.find(([name]) => name === "move")[1], { engine: "sqlite" });
});

it("refuses unknown fields, engines, out of range ports and values of another type", async () => {
	for (const body of [
		{ ...target, extra: 1 },
		{ ...target, engine: "oracle" },
		{ ...target, port: 70_000 },
		{ ...target, port: "5432" },
		{ ...target, name: 5 },
		{ ...target, ssl: { enabled: "true" } },
		{ ...target, ssl: { enabled: 1 } },
		{ ...target, ssl: { enabled: false, other: true } },
		{ host: "db" },
	]) {
		for (const path of ["/test", "/move"]) {
			const sent = await call("post", path, { body });
			assert.equal(sent.error?.name, "ValidationError", `${path} ${JSON.stringify(body)}`);
		}
	}
});

it("gives the move the promise of the answer having gone out", async () => {
	calls.length = 0;
	let given;
	const original = service.move;
	service.move = (_access, _body, options) => {
		given = options.sent;
		return Promise.resolve({ id: "m" });
	};
	const res = new EventEmitter();
	await call("post", "/move", { body: { engine: "sqlite" }, res });
	let settled = false;
	given.then(() => {
		settled = true;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(settled, false);
	res.emit("finish");
	await given;
	assert.equal(settled, true);

	const closed = new EventEmitter();
	await call("post", "/move", { body: { engine: "sqlite" }, res: closed });
	closed.emit("close");
	await given;
	service.move = original;
});

it("answers a service refusal as an error and never an answer", async () => {
	const original = service.status;
	service.status = () => Promise.reject(Object.assign(new Error("Forbidden"), { status: 403 }));
	const sent = await call("get", "/");
	assert.equal(sent.error.status, 403);
	assert.equal(sent.status, undefined);
	service.status = original;
});

it("has only the four routes, none with a parameter or wildcard", () => {
	const routes = router.stack.filter((item) => item.route).map((item) => item.route.path);
	assert.deepEqual(routes.sort(), ["/", "/move", "/test"]);
	assert.equal(router.stack.length, 3);
});

it("is open to the guard during a move on exactly the routes that write", () => {
	const maintenance = createMaintenance();
	maintenance.start("m");
	const passes = (method, path) => {
		let result;
		maintenance.guard({ method, path }, new EventEmitter(), (error) => {
			result = !error;
		});
		return result;
	};
	assert.equal(passes("POST", "/api/database/test"), true);
	assert.equal(passes("POST", "/api/database/move"), true);
	assert.equal(passes("GET", "/api/database"), true);
	assert.equal(passes("GET", "/api/database/move"), true);
	assert.equal(passes("POST", "/api/database"), false);
});
