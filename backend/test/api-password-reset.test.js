import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, it, mock } from "node:test";
import { generate } from "otplib";
import { PASSWORD, startApi } from "./support/api.js";
import { startFakeSmtp } from "./support/fake-smtp.js";

// The reset by mail through the real app and a fake SMTP server: what an outsider can tell, where the token may appear,
// what a reset keeps and ends.

const NEW_PASSWORD = "a-brand-new-password-7";
const LINK = /https:\/\/npm\.example\.test\/reset-password#token=(?<token>[A-Za-z0-9_-]{43})/u;
const INVALID = "error.reset-invalid";
const logs = [];
const realLog = console.log;

let api;
let internalPasswordReset;
let allowAddress;
let generateApiToken;
let admin;
let smtp;
let counter = 0;

const decoded = (raw) =>
	raw
		.replace(/[=]\r?\n/gu, "")
		.replace(/[=](?<hex>[0-9A-F]{2})/gu, (_, ...rest) => String.fromCharCode(Number.parseInt(rest.at(-1).hex, 16)));
const tokenOf = (raw) => decoded(raw).match(LINK)?.groups.token;
const must = (response, status = 200) => {
	if (response.status !== status) throw new Error(`answered ${response.status}: ${response.text}`);
	return response;
};
// a user with a password; options change the row
const newUser = async (extra = {}) => {
	counter += 1;
	const email = `reset-user${counter}@example.com`;
	const created = must(
		await admin.post("/users", {
			name: `Reset ${counter}`,
			email,
			roles: [],
			...(extra.auth === false ? {} : { auth: { type: "password", secret: PASSWORD } }),
		}),
		201,
	);
	await api.db("user").where({ id: created.body.id }).update({ npmpro_token_valid_after: 0 });
	if (extra.disabled) await api.db("user").where({ id: created.body.id }).update({ is_disabled: true });
	return { id: created.body.id, email };
};
const ask = (email) => api.client().post("/password-reset", { email });
const asked = async (email) => {
	const answer = await ask(email);
	await internalPasswordReset.settled();
	return answer;
};
// the token mailed to the address (the newest message to it)
const mailedTo = (email) => smtp.messages.filter((raw) => raw.includes(`To: ${email}`));
const issue = async (user) => {
	const sent = mailedTo(user.email).length;
	must(await asked(user.email), 202);
	const all = mailedTo(user.email);
	if (all.length !== sent + 1) throw new Error(`${all.length - sent} mails for one request`);
	return tokenOf(all.at(-1));
};
const shape = (answer) => ({
	status: answer.status,
	text: answer.text,
	headers: Object.fromEntries(
		[...answer.headers].filter(([name]) => !["date", "ratelimit", "ratelimit-policy"].includes(name)),
	),
});

before(async () => {
	console.log = (...args) => {
		logs.push(args.join(" "));
		realLog(...args);
	};
	api = await startApi({ env: { NPMPRO_TEST_SMTP: "loopback" } });
	admin = await api.admin();
	({ default: internalPasswordReset, allowAddress } = await import("../internal/password-reset.js"));
	({ generateApiToken } = await import("../lib/api-token.js"));
	smtp = await startFakeSmtp();
	must(await admin.put("/settings/notifications", { public_url: "https://npm.example.test" }));
	must(
		await admin.put("/settings/email", {
			host: "127.0.0.1",
			port: smtp.port,
			security: "none",
			from_address: "npmpro@example.com",
			allow_password_reset: true,
		}),
	);
});
after(async () => {
	console.log = realLog;
	mock.timers.reset();
	await smtp?.close();
	await api?.stop();
});

it("answers 202 with the same status, headers and empty body for an unknown, a disabled, an OIDC-only and a real user", async () => {
	const real = await newUser();
	const disabled = await newUser({ disabled: true });
	const oidcOnly = await newUser({ auth: false });
	const answers = [];
	for (const email of ["nobody@example.com", disabled.email, oidcOnly.email, real.email]) {
		const answer = await asked(email);
		assert.equal(answer.status, 202);
		assert.equal(answer.text, "");
		answers.push(shape(answer));
	}
	for (const other of answers.slice(1)) assert.deepEqual(other, answers[0]);
	assert.equal(mailedTo("nobody@example.com").length, 0);
	assert.equal(mailedTo(disabled.email).length, 0);
	assert.equal(mailedTo(oidcOnly.email).length, 0);
	assert.equal(mailedTo(real.email).length, 1);
	assert.equal(await api.db("npmpro_password_token").where({ user_id: disabled.id }).first(), undefined);
});

it("answers the same while reset is off, and sends nothing", async () => {
	const real = await newUser();
	const on = shape(await asked(real.email));
	must(await admin.put("/settings/email", { allow_password_reset: false }));
	try {
		const sent = mailedTo(real.email).length;
		const off = [shape(await asked(real.email)), shape(await asked("nobody@example.com"))];
		for (const answer of off) assert.deepEqual(answer, on);
		assert.equal(mailedTo(real.email).length, sent);
		// check and confirm answer as for an unknown token
		const token = tokenOf(mailedTo(real.email).at(-1));
		const check = await api.client().post("/password-reset/check", { token });
		assert.equal(check.status, 400);
		assert.equal(check.body.error.message_i18n, INVALID);
		const confirm = await api.client().post("/password-reset/confirm", { token, password: NEW_PASSWORD });
		assert.equal(confirm.status, 400);
		assert.equal(confirm.body.error.message_i18n, INVALID);
	} finally {
		must(await admin.put("/settings/email", { allow_password_reset: true }));
	}
});

it("mails the link in both parts, to the language of the user, and the token is in no log, audit or delivery row", async () => {
	const user = await newUser();
	await api.db("user").where({ id: user.id }).update({ npmpro_language: "de" });
	const token = await issue(user);
	const raw = decoded(mailedTo(user.email).at(-1));
	assert.ok(token);
	assert.equal(
		[...raw.matchAll(new RegExp(token, "gu"))].length >= 2,
		true,
		"the link is in the text and the HTML part",
	);
	assert.ok(raw.includes("Neues Passwort w"));
	assert.equal(
		logs.some((line) => line.includes(token)),
		false,
	);
	const rows = JSON.stringify([...(await api.db("audit_log")), ...(await api.db("npmpro_notification_delivery"))]);
	assert.equal(rows.includes(token), false);
	const stored = await api.db("npmpro_password_token").where({ user_id: user.id }).first();
	assert.equal(stored.token_hash, createHash("sha256").update(token).digest("hex"));
	assert.equal(JSON.stringify(stored).includes(token), false);
	// a validation error names the field and never the value
	const bad = await api.client().post("/password-reset/confirm", { token, password: "short" });
	assert.equal(bad.status, 400);
	assert.equal(bad.text.includes(token), false);
	assert.equal(bad.text.includes("short"), false);
	assert.equal(
		logs.some((line) => line.includes(token)),
		false,
	);
	const missing = await api.client().post("/password-reset/confirm", { token });
	assert.equal(missing.status, 400);
	assert.ok(missing.text.includes("password"));
	assert.equal(missing.text.includes(token), false);
});

it("answers 429 on the 6th request from one address, also for unknown addresses, counting all three routes", async () => {
	const client = api.client();
	for (let step = 0; step < 3; step += 1) {
		assert.equal((await client.post("/password-reset", { email: `nobody${step}@example.com` })).status, 202);
	}
	assert.equal((await client.post("/password-reset/check", { token: "x" })).status, 400);
	assert.equal((await client.post("/password-reset/confirm", { token: "x", password: NEW_PASSWORD })).status, 400);
	const sixth = await client.post("/password-reset", { email: "nobody-more@example.com" });
	assert.equal(sixth.status, 429);
	await internalPasswordReset.settled();
});

it("sends nothing for the 4th request for one address within an hour", async () => {
	const user = await newUser();
	for (let step = 0; step < 3; step += 1) await issue(user);
	const sent = mailedTo(user.email).length;
	assert.equal(shape(await asked(user.email)).status, 202);
	assert.equal(mailedTo(user.email).length, sent);
	// the limit is silent and in memory, keyed by the lower-cased address
	assert.equal(allowAddress(user.email.toUpperCase()), false);
	const hour = 60 * 60_000;
	assert.equal(allowAddress("Fresh@Example.com", 1000), true);
	assert.equal(allowAddress("fresh@example.com", 1001), true);
	assert.equal(allowAddress("fresh@example.com", 1002), true);
	assert.equal(allowAddress("fresh@example.com", 1003), false);
	assert.equal(allowAddress("fresh@example.com", 1000 + hour), true);
});

it("checks and confirms: a used, an expired and a replaced token answer 400, a good one works once", async () => {
	const user = await newUser();
	const first = await issue(user);
	const second = await issue(user);
	const client = api.client();
	assert.deepEqual(must(await client.post("/password-reset/check", { token: second })).body, { purpose: "reset" });
	const replaced = await client.post("/password-reset/check", { token: first });
	assert.equal(replaced.status, 400);
	assert.equal(replaced.body.error.message, "This link is invalid or has expired");
	assert.equal(replaced.body.error.message_i18n, INVALID);
	assert.equal(
		must(await client.post("/password-reset/confirm", { token: second, password: NEW_PASSWORD })).body,
		true,
	);
	for (const [route, body] of [
		["check", { token: second }],
		["confirm", { token: second, password: NEW_PASSWORD }],
	]) {
		const used = await client.post(`/password-reset/${route}`, body);
		assert.equal(used.status, 400, route);
		assert.equal(used.body.error.message_i18n, INVALID);
	}
	assert.equal(must(await api.client().post("/tokens", { identity: user.email, secret: NEW_PASSWORD })).status, 200);
	assert.equal((await api.client().post("/tokens", { identity: user.email, secret: PASSWORD })).status, 403);

	const late = await issue(user);
	mock.timers.enable({ apis: ["Date"], now: Date.now() });
	try {
		mock.timers.tick(31 * 60_000);
		const expired = await api.client().post("/password-reset/check", { token: late });
		assert.equal(expired.status, 400);
		assert.equal(
			(await api.client().post("/password-reset/confirm", { token: late, password: NEW_PASSWORD })).status,
			400,
		);
	} finally {
		mock.timers.reset();
	}
});

it("keeps the two-factor sign-in and the API tokens, signs every session out, audits and queues the notice with the count", async () => {
	const user = await newUser();
	const session = api.client();
	must(await session.post("/tokens", { identity: user.email, secret: PASSWORD }));
	assert.equal((await session.get("/users/me")).status, 200);
	const owner = await api.db("user").where({ id: user.id }).first();
	assert.ok(owner);
	// two-factor on, two API tokens (one expired)
	const made = generateApiToken();
	const stamp = Math.floor(Date.now() / 1000);
	const tokenRow = { user_id: user.id, visibility: "user", is_admin: false, created_on: stamp };
	for (const section of ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"])
		tokenRow[section] = "view";
	await api.db("npmpro_api_token").insert({
		...tokenRow,
		name: "live",
		lookup_id: made.lookupId,
		secret_hash: made.secretHash,
		expires_on: stamp + 3600,
	});
	const gone = generateApiToken();
	await api.db("npmpro_api_token").insert({
		...tokenRow,
		name: "old",
		lookup_id: gone.lookupId,
		secret_hash: gone.secretHash,
		expires_on: stamp - 10,
	});
	const setup = must(await session.post(`/users/${user.id}/mfa/totp`));
	must(
		await session.post(`/users/${user.id}/mfa/totp/enable`, {
			code: await generate({ secret: setup.body.secret }),
		}),
	);
	await new Promise((resolve) => setTimeout(resolve, 1100));

	assert.equal((await session.get("/users/me")).status, 200);
	const token = await issue(user);
	const done = must(await api.client().post("/password-reset/confirm", { token, password: NEW_PASSWORD }));
	assert.equal(done.body, true);
	assert.equal((await session.get("/users/me")).status, 401, "the old session ended");
	const bearer = await api.client().get("/users/me", { headers: { authorization: `Bearer ${made.token}` } });
	assert.equal(bearer.status, 200, "the API token still works");
	const next = await api.client().post("/tokens", { identity: user.email, secret: NEW_PASSWORD });
	assert.equal(next.status, 200);
	assert.equal(next.body.requiresTotp, true, "the next sign-in still asks for the code");

	const audit = (await api.db("audit_log").where({ action: "password-reset", object_id: user.id })).map((row) => ({
		...row,
		meta: typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta,
	}));
	assert.equal(audit.length, 1);
	assert.equal(audit[0].object_type, "user");
	assert.deepEqual(Object.keys(audit[0].meta), ["ip"]);
	assert.equal(JSON.stringify(audit).includes(token), false);
	const queued = (await api.db("npmpro_notification_delivery").where({ event: "mail.password-reset" })).filter(
		(row) => String(row.payload).includes(user.email),
	);
	assert.equal(queued.length, 1);
	const payload = JSON.parse(queued[0].payload);
	assert.equal(payload.template, "password-reset");
	assert.equal(payload.data.count, 1);
	assert.equal(JSON.stringify(queued).includes(token), false);
});

it("a password change through the user window ends an open link", async () => {
	const user = await newUser();
	const token = await issue(user);
	const own = api.client();
	must(await own.post("/tokens", { identity: user.email, secret: PASSWORD }));
	must(await own.put(`/users/${user.id}/auth`, { type: "password", current: PASSWORD, secret: NEW_PASSWORD }));
	const check = await api.client().post("/password-reset/check", { token });
	assert.equal(check.status, 400);
	assert.equal(await api.db("npmpro_password_token").where({ user_id: user.id }).first(), undefined);
});

it("lets the only administrator reset by mail", async () => {
	const admins = await api.db("user").where({ is_disabled: false }).select("id", "email", "roles");
	const sole = admins.find((row) => row.email === "admin@example.com");
	assert.ok(sole);
	const sent = mailedTo(sole.email).length;
	must(await asked(sole.email), 202);
	assert.equal(mailedTo(sole.email).length, sent + 1);
	const token = tokenOf(mailedTo(sole.email).at(-1));
	must(await api.client().post("/password-reset/confirm", { token, password: PASSWORD }));
});
