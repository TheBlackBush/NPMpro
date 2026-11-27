import assert from "node:assert/strict";
import { after, before, it, mock } from "node:test";
import { generate } from "otplib";
import { PASSWORD, startApi } from "./support/api.js";
import { startFakeSmtp } from "./support/fake-smtp.js";

// The account notices through the real app, the queue and a fake SMTP server: who gets which mail, in which language,
// what a mail may say and never says, and what the switch and a missing mail server do.

const NEW_PASSWORD = "a-changed-password-77";
const ADMIN_EMAIL = "admin@example.com";
const AN_ADMIN = "by an administrator";
const HEX_PAIR = /^[0-9A-F]{2}$/u;
const CHANGED_AT = /was changed on \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(UTC\)/u;
const TOKEN = /#token=(?<token>[A-Za-z0-9_-]{43})/u;
const SUBJECT = /^Subject: (?<subject>.*)$/mu;
const TO_LINE = /^To:.*$/mu;
const LOGS = [];
const realLog = console.log;

let api;
let admin;
let smtp;
let worker;
let internalMail;
let counter = 0;

// quoted-printable to text, the bytes read as UTF-8
const decoded = (raw) => {
	const bytes = [];
	const joined = raw.replace(/[=]\r?\n/gu, "");
	for (let at = 0; at < joined.length; at += 1) {
		const hex = joined[at] === "=" ? joined.slice(at + 1, at + 3) : "";
		if (HEX_PAIR.test(hex)) {
			bytes.push(Number.parseInt(hex, 16));
			at += 2;
		} else bytes.push(...Buffer.from(joined[at]));
	}
	return Buffer.from(bytes).toString("utf8");
};
const must = (response, status = 200) => {
	if (response.status !== status) throw new Error(`answered ${response.status}: ${response.text}`);
	return response;
};
// the queue runs twice: a pass that began before the row was added would miss it
const flush = async () => {
	await worker.runOnce();
	await worker.runOnce();
};
const mailsTo = (email) => smtp.messages.filter((raw) => raw.includes(`To: ${email}`)).map(decoded);
const everything = () => smtp.messages.map(decoded).join("\n");
const subjectOf = (text) => text.match(SUBJECT)?.groups.subject ?? "";
const newUser = async (language) => {
	counter += 1;
	const user = await api.limited({ visibility: "user" });
	if (language) must(await user.put("/users/me/language", { language }), 204);
	return user;
};
const nextPeriod = () => mock.timers.tick(31_000);
const enroll = async (user) => {
	const id = user.user.id;
	const setup = must(await user.post(`/users/${id}/mfa/totp`));
	nextPeriod();
	must(await user.post(`/users/${id}/mfa/totp/enable`, { code: await generate({ secret: setup.body.secret }) }));
	return setup.body.secret;
};
const setEmail = (change) => admin.put("/settings/email", change);

before(async () => {
	api = await startApi({ env: { NPMPRO_TEST_SMTP: "loopback" } });
	admin = await api.admin();
	console.log = (...args) => {
		LOGS.push(args.join(" "));
	};
	({ worker } = await import("../internal/notify.js"));
	({ default: internalMail } = await import("../internal/mail.js"));
	smtp = await startFakeSmtp();
	must(await admin.put("/settings/notifications", { public_url: "https://npm.example.test" }));
	must(
		await setEmail({
			host: "127.0.0.1",
			port: smtp.port,
			security: "none",
			from_address: "npmpro@example.com",
			allow_password_reset: true,
		}),
	);
	worker.start();
	mock.timers.enable({ apis: ["Date"], now: Date.now() });
});
after(async () => {
	worker.stop();
	console.log = realLog;
	mock.timers.reset();
	await smtp?.close();
	await api?.stop();
});

it("a password change by the user sends one mail to the user: no administrator, no address, no password", async () => {
	const user = await newUser();
	const { email, id } = user.user;
	must(await user.put(`/users/${id}/auth`, { type: "password", current: PASSWORD, secret: NEW_PASSWORD }));
	await flush();
	const mails = mailsTo(email);
	assert.equal(mails.length, 1);
	assert.ok(subjectOf(mails[0]).includes("password was changed"));
	assert.match(mails[0], CHANGED_AT);
	for (const text of [AN_ADMIN, ADMIN_EMAIL, NEW_PASSWORD, PASSWORD, email]) {
		assert.ok(!mails[0].replace(/^(?:To|Message-ID|Content-ID):.*$/gmu, "").includes(text), text);
	}
});

it("a password change by an administrator names an administrator, never the name or the address of the admin", async () => {
	const user = await newUser();
	const { email, id } = user.user;
	must(await admin.put(`/users/${id}/auth`, { type: "password", secret: NEW_PASSWORD }));
	await flush();
	const mails = mailsTo(email);
	assert.equal(mails.length, 1);
	assert.ok(mails[0].includes("by an administrator"));
	assert.ok(!mails[0].includes(`${ADMIN_EMAIL.split("@")[0]}@`));
	assert.ok(!mails[0].includes(NEW_PASSWORD));
	assert.equal(mailsTo(ADMIN_EMAIL).filter((one) => one.includes(email)).length, 0);
});

it("an address change mails the old address and the new one, each its own mail, the old one never names the new", async () => {
	const user = await newUser();
	const { email, id } = user.user;
	const next = `moved${counter}@example.net`;
	must(await user.put(`/users/${id}`, { email: next }));
	await flush();
	const oldMails = mailsTo(email);
	const newMails = mailsTo(next);
	assert.equal(oldMails.length, 1);
	assert.equal(newMails.length, 1);
	assert.ok(oldMails[0].includes("address of your account"));
	assert.ok(!oldMails[0].includes(next));
	assert.ok(newMails[0].includes("This address is now used"));
	assert.ok(!newMails[0].replace(TO_LINE, "").includes(email));
	// the change by an administrator mails the same two
	const again = `again${counter}@example.net`;
	must(await admin.put(`/users/${id}`, { email: again }));
	await flush();
	assert.equal(mailsTo(next).length, 2);
	assert.equal(mailsTo(again).length, 1);
	// a save without an address change sends nothing
	must(await admin.put(`/users/${id}`, { name: "Renamed" }));
	await flush();
	assert.equal(mailsTo(again).length, 1);
});

it("turning MFA off sends one mail, naming an administrator only when one did it; new backup codes once, without codes", async () => {
	const self = await newUser();
	const secret = await enroll(self);
	nextPeriod();
	const regenerated = must(
		await self.post(`/users/${self.user.id}/mfa/backup-codes`, { code: await generate({ secret }) }),
	);
	await flush();
	let mails = mailsTo(self.user.email);
	assert.equal(mails.length, 1);
	assert.ok(subjectOf(mails[0]).includes("backup codes"));
	for (const code of regenerated.body.backup_codes) assert.ok(!mails[0].includes(code));
	nextPeriod();
	must(await self.post(`/users/${self.user.id}/mfa/totp/disable`, { code: await generate({ secret }) }));
	await flush();
	mails = mailsTo(self.user.email);
	assert.equal(mails.length, 2);
	assert.ok(subjectOf(mails[1]).includes("Two-factor"));
	assert.ok(!mails[1].includes(AN_ADMIN));

	const other = await newUser();
	await enroll(other);
	await flush();
	assert.equal(mailsTo(other.user.email).length, 0, "enabling sends no notice");
	must(await admin.delete(`/users/${other.user.id}/mfa`));
	await flush();
	mails = mailsTo(other.user.email);
	assert.equal(mails.length, 1);
	assert.ok(mails[0].includes("turned off by an administrator"));
	assert.ok(!mails[0].includes(ADMIN_EMAIL));
});

it("a reset sends only 'Password was reset'; an accepted invitation sends only the invitation", async () => {
	const user = await newUser();
	must(await api.client().post("/password-reset", { email: user.user.email }), 202);
	await (await import("../internal/password-reset.js")).default.settled();
	const linkMail = mailsTo(user.user.email).at(-1);
	const token = linkMail.match(TOKEN).groups.token;
	must(await api.client().post("/password-reset/confirm", { token, password: NEW_PASSWORD }));
	await flush();
	const subjects = mailsTo(user.user.email).map(subjectOf);
	assert.equal(subjects.length, 2, subjects.join(" | "));
	assert.ok(subjects[0].includes("Reset your"));
	assert.ok(subjects[1].includes("password was reset"));

	counter += 1;
	const email = `invitee${counter}@example.com`;
	must(await admin.post("/users", { name: "Invitee", email, roles: [], invite: true }), 201);
	const invitation = mailsTo(email).at(-1);
	const invited = invitation.match(TOKEN).groups.token;
	must(await api.client().post("/password-reset/confirm", { token: invited, password: NEW_PASSWORD }));
	await flush();
	assert.equal(mailsTo(email).length, 1);
});

it("writes the mail in the language of the user and the default language otherwise", async () => {
	const german = await newUser("de");
	must(await admin.put(`/users/${german.user.id}/auth`, { type: "password", secret: NEW_PASSWORD }));
	const plain = await newUser();
	must(await admin.put(`/users/${plain.user.id}/auth`, { type: "password", secret: NEW_PASSWORD }));
	await flush();
	assert.ok(mailsTo(german.user.email)[0].includes("von einem Administrator geändert"));
	assert.ok(mailsTo(plain.user.email)[0].includes("by an administrator"));
	must(await admin.put("/settings/notifications", { default_language: "fr" }));
	const french = await newUser();
	must(await admin.put(`/users/${french.user.id}/auth`, { type: "password", secret: NEW_PASSWORD }));
	await flush();
	assert.ok(mailsTo(french.user.email)[0].includes("par un administrateur"));
	must(await admin.put("/settings/notifications", { default_language: "en" }));
});

it("sends nothing with the switch off, and nothing and no error with no mail server", async () => {
	const user = await newUser();
	const sentBefore = smtp.messages.length;
	for (const [change, label] of [
		[{ account_notices: false }, "switch off"],
		[{ account_notices: true, host: "" }, "no server"],
	]) {
		must(await setEmail(change));
		try {
			must(await admin.put(`/users/${user.user.id}/auth`, { type: "password", secret: NEW_PASSWORD }), 200);
			must(
				await admin.put(`/users/${user.user.id}`, { email: `${label.replace(" ", "")}${counter}@example.net` }),
			);
			await flush();
			assert.equal(smtp.messages.length, sentBefore, label);
		} finally {
			must(await setEmail({ account_notices: true, host: "127.0.0.1" }));
		}
	}
	const waiting = await api
		.db("npmpro_notification_delivery")
		.where({ status: "pending" })
		.count({ count: "*" })
		.first();
	assert.equal(Number(waiting.count), 0);
});

it("a notice that cannot be queued never fails the change and leaves a safe line", async () => {
	const user = await newUser();
	const failing = mock.method(internalMail, "queueMail", () =>
		Promise.reject(new Error(`boom ${NEW_PASSWORD} ${user.user.email}`)),
	);
	try {
		must(await admin.put(`/users/${user.user.id}/auth`, { type: "password", secret: NEW_PASSWORD }));
	} finally {
		failing.mock.restore();
	}
	const line = LOGS.find((one) => one.includes("password changed notice could not be queued"));
	assert.ok(line);
	assert.ok(!line.includes(NEW_PASSWORD) && !line.includes(user.user.email));
	assert.ok(!everything().includes("boom"));
});

it("MAIL_ACCOUNT_NOTICES=false in the environment sends nothing", async () => {
	const user = await newUser();
	process.env.MAIL_ACCOUNT_NOTICES = "false";
	try {
		must(await admin.put(`/users/${user.user.id}/auth`, { type: "password", secret: NEW_PASSWORD }));
		await flush();
	} finally {
		delete process.env.MAIL_ACCOUNT_NOTICES;
	}
	assert.equal(mailsTo(user.user.email).length, 0);
});

it("an administrator setting the password of an invited user sends one 'changed' notice and ends the invitation", async () => {
	counter += 1;
	const email = `invitee-admin${counter}@example.com`;
	const created = must(await admin.post("/users", { name: "Invitee", email, roles: [], invite: true }), 201);
	const token = mailsTo(email).at(-1).match(TOKEN).groups.token;
	must(await admin.put(`/users/${created.body.id}/auth`, { type: "password", secret: NEW_PASSWORD }));
	await flush();
	const subjects = mailsTo(email).map(subjectOf);
	assert.equal(subjects.length, 2, subjects.join(" | "));
	assert.ok(subjects[1].includes("password was changed"));
	const used = await api.client().post("/password-reset/confirm", { token, password: "another-one-12345" });
	assert.equal(used.status, 400);
});

it("a user lookup that fails before the write leaves MFA on and the notice code never throws into the request", async () => {
	const user = await newUser();
	const secret = await enroll(user);
	const { default: internalUser } = await import("../internal/user.js");
	const lookup = mock.method(internalUser, "get", () => Promise.reject(new Error("gone")));
	nextPeriod();
	try {
		const refused = await user.post(`/users/${user.user.id}/mfa/totp/disable`, {
			code: await generate({ secret }),
		});
		assert.notEqual(refused.status, 200);
	} finally {
		lookup.mock.restore();
	}
	assert.equal(must(await user.get(`/users/${user.user.id}/mfa`)).body.totp_enabled, true);
	await flush();
	assert.equal(mailsTo(user.user.email).length, 0);
});
