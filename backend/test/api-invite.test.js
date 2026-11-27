import assert from "node:assert/strict";
import { after, before, beforeEach, it, mock } from "node:test";
import { PASSWORD, startApi } from "./support/api.js";
import { startFakeSmtp } from "./support/fake-smtp.js";

// Invitations through the real app and a fake SMTP server: the create and the resend, the purpose and the lifetime of
// the token, who can accept, what an outsider can tell, and where the token may appear.

const NEW_PASSWORD = "an-invited-password-9";
const LINK = /https:\/\/npm\.example\.test\/reset-password#token=(?<token>[A-Za-z0-9_-]{43})/u;
const INVALID = "error.reset-invalid";
const HOUR = 60 * 60_000;
const logs = [];
const realLog = console.log;

let api;
let admin;
let smtp;
let refusing;
let tokens;
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
const mailedTo = (email) => smtp.messages.filter((raw) => raw.includes(`To: ${email}`));
const invitedBody = (extra = {}) => {
	counter += 1;
	return { name: `Invited ${counter}`, email: `invited${counter}@example.com`, roles: [], invite: true, ...extra };
};
// an invited user and the token of the mail
const invite = async (extra) => {
	const body = invitedBody(extra);
	const created = must(await admin.post("/users", body), 201);
	const raw = mailedTo(body.email).at(-1);
	return { id: created.body.id, email: body.email, created, token: raw ? tokenOf(raw) : undefined };
};
const serverSettings = (port) =>
	admin.put("/settings/email", {
		host: "127.0.0.1",
		port,
		security: "none",
		from_address: "npmpro@example.com",
		allow_password_reset: true,
	});
const rowOf = (id, purpose) => api.db("npmpro_password_token").where({ user_id: id, purpose });
const parsed = (meta) => (typeof meta === "string" ? JSON.parse(meta) : meta);

before(async () => {
	api = await startApi({ env: { NPMPRO_TEST_SMTP: "loopback" } });
	admin = await api.admin();
	// startApi silences console.log, which is what the backend logger writes through: capture after it
	console.log = (...args) => {
		logs.push(args.join(" "));
	};
	({ default: tokens } = await import("../internal/password-token.js"));
	smtp = await startFakeSmtp();
	refusing = await startFakeSmtp({ mode: "rcpt-550" });
	must(await admin.put("/settings/notifications", { public_url: "https://npm.example.test" }));
	must(await serverSettings(smtp.port));
});
// a refused request counts toward the limit of the address: every test starts with its own signed-in client
beforeEach(async () => {
	admin = api.client();
	must(await admin.post("/tokens", { identity: "admin@example.com", secret: PASSWORD }));
});
after(async () => {
	console.log = realLog;
	mock.timers.reset();
	await smtp?.close();
	await refusing?.close();
	await api?.stop();
});

it("creates an invited user without a password: one mail with a #token= link, invitation.sent true", async () => {
	const user = await invite();
	assert.equal(user.created.body.invitation.sent, true);
	assert.equal(user.created.body.invited, true);
	assert.equal(mailedTo(user.email).length, 1);
	assert.match(user.token, /^[A-Za-z0-9_-]{43}$/u);
	assert.equal(await api.db("auth").where({ user_id: user.id }).first(), undefined);
	const row = await rowOf(user.id, "invite").first();
	assert.ok(row);
	const lifetime =
		new Date(`${row.expires_on.replace(" ", "T")}Z`) - new Date(`${row.created_on.replace(" ", "T")}Z`);
	assert.equal(lifetime, 72 * HOUR);
	const list = must(await admin.get("/users")).body.find((one) => one.id === user.id);
	assert.equal(list.invited, true);
	assert.equal(list.npmpro_has_password, false);
	// nobody signs in without a password
	assert.equal((await api.client().post("/tokens", { identity: user.email, secret: PASSWORD })).status, 403);
});

it("refuses an invitation together with a password and for a disabled user", async () => {
	const withPassword = await admin.post("/users", invitedBody({ auth: { type: "password", secret: PASSWORD } }));
	assert.equal(withPassword.status, 400);
	assert.equal(withPassword.body.error.message_i18n, "error.invite-not-allowed");
	const disabled = await admin.post("/users", invitedBody({ is_disabled: true }));
	assert.equal(disabled.status, 400);
	assert.equal(disabled.body.error.message_i18n, "error.invite-not-allowed");
});

it("a failing mail server: the user exists, invitation.sent false with a scrubbed text and no token anywhere", async () => {
	must(await serverSettings(refusing.port));
	try {
		const body = invitedBody();
		const created = must(await admin.post("/users", body), 201);
		assert.equal(created.body.invitation.sent, false);
		assert.ok(created.body.invitation.error.length > 0 && created.body.invitation.error.length <= 300);
		assert.ok(created.body.invitation.error_i18n);
		assert.ok(await api.db("user").where({ email: body.email }).first());
		assert.equal(refusing.messages.length, 0);
		const text = JSON.stringify(created.body);
		assert.doesNotMatch(text, /#token=|[A-Za-z0-9_-]{43}/u);
		assert.ok(!text.includes(body.email.replace("@", " ")));
	} finally {
		must(await serverSettings(smtp.port));
	}
});

it("is refused with no user created when invitations are not offered", async () => {
	for (const [change, label] of [
		[{ invitations: false }, "switched off"],
		[{ host: "" }, "no mail server"],
	]) {
		const usersBefore = await api.db("user").count({ count: "*" }).first();
		must(await admin.put("/settings/email", change));
		try {
			const body = invitedBody();
			const refused = await admin.post("/users", body);
			assert.equal(refused.status, 400, label);
			assert.equal(refused.body.error.message_i18n, "error.invite-not-offered", label);
			assert.equal(await api.db("user").where({ email: body.email }).first(), undefined, label);
			assert.equal(Number((await api.db("user").count({ count: "*" }).first()).count), Number(usersBefore.count));
			const user = await invite_without_offer();
			const again = await admin.post(`/users/${user}/invite`);
			assert.equal(again.status, 400, label);
			assert.equal(again.body.error.message_i18n, "error.invite-not-offered", label);
		} finally {
			must(await serverSettings(smtp.port));
			must(await admin.put("/settings/email", { invitations: true }));
		}
	}
});

// an invited user made while invitations were offered, found again after they are switched off
async function invite_without_offer() {
	must(await admin.put("/settings/email", { invitations: true }));
	must(await serverSettings(smtp.port));
	const user = await invite();
	must(await admin.put("/settings/email", { invitations: false }));
	return user.id;
}

it("sends a new invitation: the new token replaces the old one, the old link is invalid", async () => {
	const user = await invite();
	const again = must(await admin.post(`/users/${user.id}/invite`));
	assert.equal(again.body.invitation.sent, true);
	assert.equal(again.body.invited, true);
	const mails = mailedTo(user.email);
	assert.equal(mails.length, 2);
	const fresh = tokenOf(mails.at(-1));
	assert.notEqual(fresh, user.token);
	const client = api.client();
	const old = await client.post("/password-reset/check", { token: user.token });
	assert.equal(old.status, 400);
	assert.equal(old.body.error.message_i18n, INVALID);
	assert.equal(must(await client.post("/password-reset/check", { token: fresh })).body.purpose, "invite");
	assert.equal((await rowOf(user.id, "invite")).length, 1);
});

it("refuses to invite a user with a password, an OIDC link or a disabled user: error.invite-not-allowed", async () => {
	const withPassword = must(
		await admin.post("/users", {
			name: "Has password",
			email: "has-password@example.com",
			roles: [],
			auth: { type: "password", secret: PASSWORD },
		}),
		201,
	);
	const linked = await invite();
	await api
		.db("user")
		.where({ id: linked.id })
		.update({ npmpro_oidc_subject: "subject-1", npmpro_oidc_linked_on: "2026-11-01 10:00:00" });
	const disabled = await invite();
	must(await admin.put(`/users/${disabled.id}`, { is_disabled: true }));
	const adminId = must(await admin.get("/users/me")).body.id;
	for (const id of [withPassword.body.id, linked.id, disabled.id, adminId]) {
		const refused = await admin.post(`/users/${id}/invite`);
		assert.equal(refused.status, 400, `user ${id}`);
		assert.equal(refused.body.error.message_i18n, "error.invite-not-allowed", `user ${id}`);
	}
	assert.equal(mailedTo("has-password@example.com").length, 0);
	assert.equal((await admin.get("/users")).body.find((one) => one.id === linked.id).invited, false);
	assert.equal((await admin.get("/users")).body.find((one) => one.id === disabled.id).invited, false);
	assert.equal((await admin.post("/users/9999/invite")).status, 404);
});

it("the resend is for a session of an administrator only", async () => {
	const user = await invite();
	// an administrator API token is refused by the user management guard
	const { generateApiToken } = await import("../lib/api-token.js");
	const made = generateApiToken();
	const stamp = Math.floor(Date.now() / 1000);
	const adminId = must(await admin.get("/users/me")).body.id;
	await api.db("npmpro_api_token").insert({
		user_id: adminId,
		visibility: "all",
		is_admin: true,
		created_on: stamp,
		name: "invite",
		lookup_id: made.lookupId,
		secret_hash: made.secretHash,
		expires_on: stamp + 3600,
		proxy_hosts: "manage",
		redirection_hosts: "manage",
		dead_hosts: "manage",
		streams: "manage",
		access_lists: "manage",
		certificates: "manage",
	});
	const viaToken = await api.client().post(`/users/${user.id}/invite`, undefined, {
		headers: { authorization: `Bearer ${made.token}` },
	});
	assert.equal(viaToken.status, 403);
	const plain = await admin.post("/users", {
		name: "Plain",
		email: "plain-user@example.com",
		roles: [],
		auth: { type: "password", secret: PASSWORD },
	});
	const session = api.client();
	must(await session.post("/tokens", { identity: "plain-user@example.com", secret: PASSWORD }));
	assert.equal((await session.post(`/users/${user.id}/invite`)).status, 403);
	assert.equal((await api.client().post(`/users/${user.id}/invite`)).status, 401);
	assert.equal(plain.status, 201);
	assert.equal(mailedTo(user.email).length, 1);
});

it("the invite token is valid at 71 hours and invalid at 73 hours", async () => {
	const early = await invite();
	const late = await invite();
	mock.timers.enable({ apis: ["Date"], now: Date.now() });
	try {
		mock.timers.tick(71 * HOUR);
		assert.equal((await api.client().post("/password-reset/check", { token: early.token })).status, 200);
		mock.timers.tick(2 * HOUR);
		for (const user of [early, late]) {
			const check = await api.client().post("/password-reset/check", { token: user.token });
			assert.equal(check.status, 400);
			assert.equal(check.body.error.message_i18n, INVALID);
			const confirm = await api
				.client()
				.post("/password-reset/confirm", { token: user.token, password: NEW_PASSWORD });
			assert.equal(confirm.status, 400);
		}
	} finally {
		mock.timers.reset();
	}
	assert.equal(await api.db("auth").where({ user_id: early.id }).first(), undefined);
});

it("keeps the purpose and the lifetime of each token: an invite token is never a reset token and the reverse", async () => {
	const user = await invite();
	const reset = await tokens.create(user.id, "reset");
	const resetRow = await rowOf(user.id, "reset").first();
	const span = (row) =>
		new Date(`${row.expires_on.replace(" ", "T")}Z`) - new Date(`${row.created_on.replace(" ", "T")}Z`);
	assert.equal(span(resetRow), 30 * 60_000);
	assert.equal(span(await rowOf(user.id, "invite").first()), 72 * HOUR);
	// the one token per user and purpose: both live side by side
	assert.equal(await tokens.find(user.token, "reset"), null);
	assert.equal(await tokens.find(reset, "invite"), null);
	assert.equal(await tokens.consume(user.token, () => true, "reset"), null);
	assert.equal(await tokens.consume(reset, () => true, "invite"), null);
	assert.ok(await tokens.find(user.token, "invite"));
	// a reset token for an invited user (no password row) sets no password
	const client = api.client();
	assert.equal((await client.post("/password-reset/confirm", { token: reset, password: NEW_PASSWORD })).status, 400);
	assert.equal(await api.db("auth").where({ user_id: user.id }).first(), undefined);
	assert.equal(must(await admin.get("/users")).body.find((one) => one.id === user.id).invited, true);
});

it("the invite token sets the first password once, the user signs in, audit invitation-accepted with only the address, no notice mail", async () => {
	const user = await invite();
	const mailsBefore = smtp.messages.length;
	const client = api.client();
	assert.equal(must(await client.post("/password-reset/check", { token: user.token })).body.purpose, "invite");
	assert.equal(
		must(await client.post("/password-reset/confirm", { token: user.token, password: NEW_PASSWORD })).body,
		true,
	);
	assert.equal(smtp.messages.length, mailsBefore);
	assert.equal(mailedTo(user.email).length, 1);
	assert.equal(must(await api.client().post("/tokens", { identity: user.email, secret: NEW_PASSWORD })).status, 200);
	const again = await client.post("/password-reset/confirm", { token: user.token, password: "another-password-12" });
	assert.equal(again.status, 400);
	assert.equal(again.body.error.message_i18n, INVALID);
	assert.equal(
		(await api.client().post("/tokens", { identity: user.email, secret: "another-password-12" })).status,
		403,
	);
	const rows = await api.db("audit_log").where({ action: "invitation-accepted", object_id: user.id });
	assert.equal(rows.length, 1);
	assert.deepEqual(Object.keys(parsed(rows[0].meta)), ["ip"]);
	assert.equal(await api.db("audit_log").where({ action: "password-reset", object_id: user.id }).first(), undefined);
	assert.equal(await api.db("npmpro_password_token").where({ user_id: user.id }).first(), undefined);
	// accepted: no longer invited, nothing more to send
	assert.equal(must(await admin.get("/users")).body.find((one) => one.id === user.id).invited, false);
	assert.equal((await admin.post(`/users/${user.id}/invite`)).status, 400);
});

it("a disabled invited user cannot accept, and enabling them again brings no old link back", async () => {
	const user = await invite();
	must(await admin.put(`/users/${user.id}`, { is_disabled: true }));
	const client = api.client();
	for (const [route, body] of [
		["check", { token: user.token }],
		["confirm", { token: user.token, password: NEW_PASSWORD }],
	]) {
		const answer = await client.post(`/password-reset/${route}`, body);
		assert.equal(answer.status, 400, route);
		assert.equal(answer.body.error.message_i18n, INVALID, route);
	}
	must(await admin.put(`/users/${user.id}`, { is_disabled: false }));
	assert.equal((await client.post("/password-reset/check", { token: user.token })).status, 400);
	assert.equal(await api.db("auth").where({ user_id: user.id }).first(), undefined);
});

it("a password or an OIDC link made since the invitation ends it: 400 and no password written", async () => {
	const withPassword = await invite();
	await api.db("auth").insert({
		user_id: withPassword.id,
		type: "password",
		secret: "not-a-hash",
		meta: "{}",
		created_on: "2026-11-01 10:00:00",
		modified_on: "2026-11-01 10:00:00",
	});
	const linked = await invite();
	await api
		.db("user")
		.where({ id: linked.id })
		.update({ npmpro_oidc_subject: "subject-2", npmpro_oidc_linked_on: "2026-11-01 10:00:00" });
	for (const user of [withPassword, linked]) {
		const client = api.client();
		assert.equal((await client.post("/password-reset/check", { token: user.token })).status, 400);
		const confirm = await client.post("/password-reset/confirm", { token: user.token, password: NEW_PASSWORD });
		assert.equal(confirm.status, 400);
		assert.equal(confirm.body.error.message_i18n, INVALID);
	}
	assert.equal((await api.db("auth").where({ user_id: withPassword.id }).first()).secret, "not-a-hash");
	assert.equal(await api.db("auth").where({ user_id: linked.id }).first(), undefined);
});

it("a reset request for an invited user sends nothing and answers the same 202", async () => {
	const user = await invite();
	const { default: internalPasswordReset } = await import("../internal/password-reset.js");
	const mailsBefore = smtp.messages.length;
	const real = must(await api.client().post("/password-reset", { email: user.email }), 202);
	await internalPasswordReset.settled();
	const unknown = must(await api.client().post("/password-reset", { email: "nobody-invited@example.com" }), 202);
	await internalPasswordReset.settled();
	assert.equal(real.text, unknown.text);
	assert.equal(smtp.messages.length, mailsBefore);
	assert.equal((await rowOf(user.id, "reset")).length, 0);
});

it("writes the mail in the language of the invited user, else the default language", async () => {
	const first = await invite();
	assert.match(decoded(mailedTo(first.email).at(-1)), /You were invited to NPMpro at/u);
	const german = await invite();
	await api.db("user").where({ id: german.id }).update({ npmpro_language: "de" });
	must(await admin.post(`/users/${german.id}/invite`));
	const text = decoded(mailedTo(german.email).at(-1));
	assert.match(text, /Du wurdest zu NPMpro auf npm\.example\.test eingeladen/u);
	assert.doesNotMatch(text, /You were invited/u);
	// never the address of the inviter
	assert.doesNotMatch(text, /admin@example\.com/u);
});

it("no token and no link in any log line or audit row", async () => {
	const user = await invite();
	must(await admin.post(`/users/${user.id}/invite`));
	const all = [user.token, tokenOf(mailedTo(user.email).at(-1))];
	await api.client().post("/password-reset/confirm", { token: all[1], password: NEW_PASSWORD });
	const audit = JSON.stringify(await api.db("audit_log").select());
	const output = logs.join("\n");
	for (const token of all) {
		assert.ok(token);
		assert.ok(!output.includes(token), "a log line");
		assert.ok(!audit.includes(token), "an audit row");
	}
	assert.ok(!output.includes("#token="));
	assert.ok(!audit.includes("reset-password#"));
});

it("maps a failed send to a scrubbed text of at most 300 characters and a translation key", async () => {
	const { sendFailureOf } = await import("../internal/mail-setting.js");
	const { MailError } = await import("../lib/mail/transport.js");
	const { default: errs } = await import("../lib/error.js");
	const blocked = await sendFailureOf(Object.assign(new Error("resolved 10.0.0.1"), { code: "EBLOCKED" }));
	assert.equal(blocked.error_i18n, "error.mail-host-blocked");
	assert.equal(blocked.error_values.host, "127.0.0.1");
	assert.doesNotMatch(JSON.stringify(blocked), /10\.0\.0\.1/u);
	const refused = await sendFailureOf(
		new errs.ValidationError("The recipient address is not valid", "error.mail-bad-recipient"),
	);
	assert.deepEqual(refused, { error: "The recipient address is not valid", error_i18n: "error.mail-bad-recipient" });
	const known = await sendFailureOf(
		new MailError("The login failed", {
			message_i18n: "error.mail-auth",
			message_values: { error: "x".repeat(500) },
		}),
	);
	assert.equal(known.error_i18n, "error.mail-auth");
	assert.equal(known.error_values.error.length, 300);
	const unknown = await sendFailureOf(new Error("boom with secret-value"));
	assert.equal(unknown.error, "The mail could not be sent");
	assert.equal(unknown.error_i18n, "error.invite-mail-failed");
	const long = await sendFailureOf(new MailError("y".repeat(500)));
	assert.equal(long.error.length, 300);
});
