import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { generateApiToken } from "../lib/api-token.js";
import { startApi } from "./support/api.js";

const SECTIONS = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"];
const levels = (level) => ({ visibility: "user", ...Object.fromEntries(SECTIONS.map((s) => [s, level])) });
const now = () => Math.floor(Date.now() / 1000);
const INITIALIZE = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
};

let api;
let admin;
let tokens = 0;

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

const makeToken = async (fields = {}) => {
	const made = generateApiToken();
	tokens += 1;
	const { id } = await admin.get("/users/me").then((res) => res.body);
	await api.db("npmpro_api_token").insert({
		user_id: id,
		name: `mcp ${tokens}`,
		lookup_id: made.lookupId,
		secret_hash: made.secretHash,
		...levels("view"),
		created_on: now(),
		expires_on: now() + 3600,
		...fields,
	});
	return made.token;
};
const send = (token, body, headers = {}) =>
	api.client().post("/mcp", body, { headers: { authorization: `Bearer ${token}`, ...headers } });

it("refuses a request without an Authorization header", async () => {
	const res = await api.client().post("/mcp", INITIALIZE);
	assert.equal(res.status, 401);
	assert.match(res.headers.get("www-authenticate"), /Bearer/u);
});

it("refuses the admin's session and a foreign bearer", async () => {
	assert.equal((await admin.post("/mcp", INITIALIZE)).status, 401);
	const foreign = await admin.post("/mcp", INITIALIZE, { headers: { authorization: "Bearer abc.def.ghi" } });
	assert.equal(foreign.status, 401);
});

it("refuses an expired and a revoked token", async () => {
	const expired = await makeToken({ expires_on: now() - 10 });
	assert.equal((await send(expired, INITIALIZE)).status, 401);
	const revoked = await makeToken();
	assert.equal((await send(revoked, INITIALIZE)).status, 200);
	await api
		.db("npmpro_api_token")
		.where({ name: `mcp ${tokens}` })
		.delete();
	assert.equal((await send(revoked, INITIALIZE)).status, 401);
});

it("a token alone drives the protocol", async () => {
	const token = await makeToken();
	const init = await send(token, INITIALIZE);
	assert.equal(init.status, 200);
	assert.match(init.headers.get("content-type"), /application\/json/u);
	assert.equal(init.body.result.serverInfo.name, "npmpro");
	const note = await send(token, { jsonrpc: "2.0", method: "notifications/initialized" });
	assert.equal(note.status, 202);
	assert.ok(!note.body || Object.keys(note.body).length === 0);
	const list = await send(token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
	assert.equal(list.status, 200);
	assert.ok(Array.isArray(list.body.result.tools));
});

it("a session cookie sent with a token is ignored", async () => {
	const token = await makeToken();
	const res = await admin.post("/mcp", INITIALIZE, { headers: { authorization: `Bearer ${token}` } });
	assert.equal(res.status, 200);
});

it("refuses an unknown protocol version header", async () => {
	const token = await makeToken();
	assert.equal((await send(token, INITIALIZE, { "mcp-protocol-version": "2099-01-01" })).status, 400);
	assert.equal((await send(token, INITIALIZE, { "mcp-protocol-version": "2025-06-18" })).status, 200);
});

it("answers GET and DELETE with 405", async () => {
	const token = await makeToken();
	const auth = { headers: { authorization: `Bearer ${token}` } };
	for (const method of ["get", "delete"]) {
		const res = await api.client()[method]("/mcp", auth);
		assert.equal(res.status, 405);
		assert.equal(res.headers.get("allow"), "POST");
	}
});

it("rejects a foreign origin", async () => {
	const token = await makeToken();
	assert.equal((await send(token, INITIALIZE, { origin: "https://evil.example" })).status, 403);
});

it("lists the tool catalogue for an administrator only", async () => {
	const res = await admin.get("/mcp/tools");
	assert.equal(res.status, 200);
	assert.ok(Array.isArray(res.body));
	const limited = await api.limited(levels("view"));
	assert.equal((await limited.get("/mcp/tools")).status, 403);
});
