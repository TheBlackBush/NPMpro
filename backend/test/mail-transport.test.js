import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import dns from "node:dns";
import fs from "node:fs";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import nodemailer from "nodemailer";
import { startFakeSmtp } from "./support/fake-smtp.js";
import { opensslMissing } from "./support/tls-files.js";

const { checkSmtpTarget } = await import("../lib/mail/smtp-target.js");
const { classifySmtpError, createMailTransport, MailError, sendMail } = await import("../lib/mail/transport.js");
const { EMAIL_DEFAULTS } = await import("../lib/mail/settings-rules.js");

const realLookup = dns.lookup;
let answers = new Map();
dns.lookup = (hostname, options, callback) => {
	const done = typeof options === "function" ? options : callback;
	const queue = answers.get(hostname);
	if (!queue && isIP(hostname) !== 0) return realLookup(hostname, options, callback);
	if (!queue) return done(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
	const list = queue.length > 1 ? queue.shift() : queue[0];
	if (list instanceof Error) return done(list);
	return done(
		null,
		list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
	);
};
after(() => {
	dns.lookup = realLookup;
});

const ENV_KEYS = ["NPMPRO_TEST_ROOT", "NPMPRO_TEST_SMTP"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const enableLoopbackHook = () => {
	process.env.NPMPRO_TEST_ROOT = "/tmp/npmpro-test";
	process.env.NPMPRO_TEST_SMTP = "loopback";
};
beforeEach(() => {
	answers = new Map();
	for (const key of ENV_KEYS) delete process.env[key];
});
afterEach(() => {
	for (const key of ENV_KEYS) {
		if (savedEnv[key] === undefined) delete process.env[key];
		else process.env[key] = savedEnv[key];
	}
});

const PLAIN_PART = /plain part/u;
const HTML_PART = /<p>html part<\/p>/u;
const SUBJECT = /Subject: Hello/u;
const FROM = /From: NPMpro <npm@example\.com>/u;
const CODE_450 = /450/u;
const CODE_550 = /550/u;
const BASE64_PASSWORD = /czNjcmV0LXBhc3Mtd29yZA|hunter22|abc123/u;
const URL_SECRETS = /hunter22|abc123/u;
const PASSWORD = /s3cret-pass-word/u;
const STARS = /\*\*\*/u;
const PORT_INVALID = /settings\.email\.port\.invalid/u;
const NOT_REACH = /may not reach/u;

const base = { security: "starttls", username: "" };
const codeOf = (target) =>
	checkSmtpTarget(target).then(
		() => "passed",
		(err) => err.code,
	);

describe("checkSmtpTarget", () => {
	it("refuses IP literals that are loopback, link-local or unspecified", async () => {
		for (const host of ["127.0.0.1", "::1", "[::1]", "169.254.1.1", "0.0.0.0"]) {
			assert.equal(await codeOf({ ...base, host }), "EBLOCKED");
		}
	});

	it("refuses localhost and a name with a mixed answer, passes a LAN name", async () => {
		answers.set("localhost", [["127.0.0.1"]]);
		answers.set("mixed.test", [["10.0.0.5", "127.0.0.1"]]);
		answers.set("lan.test", [["10.0.0.5"]]);
		assert.equal(await codeOf({ ...base, host: "localhost" }), "EBLOCKED");
		assert.equal(await codeOf({ ...base, host: "mixed.test" }), "EBLOCKED");
		const lan = await checkSmtpTarget({ ...base, host: "lan.test" });
		assert.deepEqual([lan.address, lan.family], ["10.0.0.5", 4]);
	});

	it("passes an IP literal on a public address and returns the first checked address", async () => {
		const pub = await checkSmtpTarget({ ...base, host: "93.184.216.34" });
		assert.deepEqual([pub.address, pub.family], ["93.184.216.34", 4]);
		answers.set("two.test", [["10.0.0.7", "10.0.0.8"]]);
		assert.equal((await checkSmtpTarget({ ...base, host: "two.test" })).address, "10.0.0.7");
	});

	it("refuses a decimal literal host through the resolver", async () => {
		answers.set("2130706433", [["127.0.0.1"]]);
		assert.equal(await codeOf({ ...base, host: "2130706433" }), "EBLOCKED");
	});

	it("lists the checked addresses with IPv4 first", async () => {
		answers.set("dual.test", [["2001:4860:4860::8888", "93.184.216.34"]]);
		const target = await checkSmtpTarget({ ...base, host: "dual.test" });
		assert.deepEqual(
			target.addresses.map(({ address }) => address),
			["93.184.216.34", "2001:4860:4860::8888"],
		);
		assert.equal(target.address, "93.184.216.34");
	});

	it("tells a missing name from a resolver outage", async () => {
		for (const code of ["ENOTFOUND", "ENODATA"]) {
			answers.set("gone.test", [Object.assign(new Error(code), { code })]);
			assert.equal(await codeOf({ ...base, host: "gone.test" }), "mail-host-unresolved", code);
		}
		answers.set("blip.test", [Object.assign(new Error("again"), { code: "EAI_AGAIN" })]);
		assert.equal(await codeOf({ ...base, host: "blip.test" }), "mail-host-lookup-failed");
	});

	it("refuses a name that does not resolve", async () => {
		assert.equal(await codeOf({ ...base, host: "nowhere.test" }), "mail-host-unresolved");
	});

	it("refuses a login in plain text to a public address and passes a private one", async () => {
		const plain = { security: "none", username: "user" };
		assert.equal(await codeOf({ ...plain, host: "93.184.216.34" }), "mail-plain-credentials");
		assert.equal((await checkSmtpTarget({ ...plain, host: "192.168.1.5" })).address, "192.168.1.5");
		assert.equal((await checkSmtpTarget({ security: "none", username: "", host: "93.184.216.34" })).family, 4);
	});

	it("the test hook lets loopback pass only with the test root", async () => {
		process.env.NPMPRO_TEST_SMTP = "loopback";
		assert.equal(await codeOf({ ...base, host: "127.0.0.1" }), "EBLOCKED");
		delete process.env.NPMPRO_TEST_SMTP;
		process.env.NPMPRO_TEST_ROOT = "/tmp/npmpro-test";
		assert.equal(await codeOf({ ...base, host: "127.0.0.1" }), "EBLOCKED");
		enableLoopbackHook();
		assert.equal((await checkSmtpTarget({ ...base, host: "127.0.0.1" })).address, "127.0.0.1");
		assert.equal((await checkSmtpTarget({ ...base, host: "::1" })).address, "::1");
		// the hook never opens link-local
		assert.equal(await codeOf({ ...base, host: "169.254.1.1" }), "EBLOCKED");
	});
});

describe("classifySmtpError", () => {
	it("decides on the reply class, then the code", () => {
		const cases = [
			[{ responseCode: 450, code: "EENVELOPE" }, "retry"],
			[{ responseCode: 421, code: "EPROTOCOL" }, "retry"],
			[{ responseCode: 550, code: "EENVELOPE" }, "fail"],
			[{ responseCode: 503, code: "EPROTOCOL", permanent: false }, "fail"],
			[{ responseCode: 535, code: "EAUTH" }, "fail"],
			[{ code: "EAUTH" }, "fail"],
			[{ code: "ECONNECTION" }, "retry"],
			[{ code: "ETIMEDOUT" }, "retry"],
			[{ code: "EDNS" }, "retry"],
			[{ code: "ESOCKET", originalCode: "ECONNREFUSED" }, "retry"],
			[{ code: "ESOCKET", originalCode: "ERR_TLS_CERT_ALTNAME_INVALID" }, "fail"],
			[{ code: "ESOCKET", originalCode: "DEPTH_ZERO_SELF_SIGNED_CERT" }, "fail"],
			[{ code: "ESOCKET" }, "retry"],
			[{ code: "EBLOCKED" }, "fail"],
			[{ code: "ETLS" }, "fail"],
			[undefined, "fail"],
		];
		for (const [err, expected] of cases) assert.equal(classifySmtpError(err), expected, JSON.stringify(err));
	});
});

describe("createMailTransport", () => {
	const values = { ...EMAIL_DEFAULTS, host: "smtp.example.com", port: 465, security: "tls", verify_tls: false };

	it("pins the address, the servername and the timeouts", () => {
		const { options } = createMailTransport(values, { address: "10.0.0.5", ehloName: "npm.example.com" });
		assert.equal(options.host, "10.0.0.5");
		assert.equal(options.port, 465);
		assert.equal(options.secure, true);
		assert.equal(options.requireTLS, false);
		assert.equal(options.ignoreTLS, false);
		assert.deepEqual(options.tls, { servername: "smtp.example.com", rejectUnauthorized: false });
		assert.equal(options.name, "npm.example.com");
		assert.equal(options.connectionTimeout, 10_000);
		assert.equal(options.greetingTimeout, 10_000);
		assert.equal(options.socketTimeout, 30_000);
		assert.equal(options.logger, false);
		assert.equal(options.debug, false);
		assert.equal(options.pool, undefined);
		assert.equal(options.auth, undefined);
	});

	it("maps the security modes and sets auth only with a username", () => {
		const mode = (security) =>
			createMailTransport(
				{ ...values, security, username: "u", password: "p" },
				{ address: "10.0.0.5", ehloName: "x" },
			).options;
		assert.equal(mode("starttls").requireTLS, true);
		assert.equal(mode("none").ignoreTLS, true);
		assert.deepEqual(mode("none").auth, { user: "u", pass: "p" });
	});
});

describe("sendMail", () => {
	let server;
	const message = { to: "to@example.com", subject: "Hello", text: "plain part", html: "<p>html part</p>" };
	const valuesFor = (extra = {}) => ({
		...EMAIL_DEFAULTS,
		host: "127.0.0.1",
		port: server.port,
		security: "none",
		from_address: "npm@example.com",
		from_name: "NPMpro",
		...extra,
	});
	const send = (extra, msg = message) => sendMail(valuesFor(extra), msg, { ehloName: "npm.example.com" });
	const failure = (extra) =>
		send(extra).then(
			() => null,
			(error) => error,
		);
	const open = async (mode, options) => {
		enableLoopbackHook();
		server = await startFakeSmtp({ mode, ...options });
	};
	afterEach(async () => {
		await server?.close();
		server = null;
	});

	it("sends one message with both parts", async () => {
		await open("accept");
		assert.deepEqual(await send({}), { ok: true });
		assert.equal(server.messages.length, 1);
		const raw = server.messages[0];
		assert.match(raw, PLAIN_PART);
		assert.match(raw, HTML_PART);
		assert.match(raw, SUBJECT);
		assert.match(raw, FROM);
	});

	it("sends a login over AUTH PLAIN", async () => {
		await open("accept");
		await send({ username: "user", password: "pa55word" });
		assert.deepEqual(server.logins[0], { user: "user", password: "pa55word" });
	});

	it("a 450 at RCPT retries and a 550 fails", async () => {
		await open("rcpt-450");
		const temporary = await failure({});
		assert.ok(temporary instanceof MailError);
		assert.equal(temporary.retry, true);
		assert.match(temporary.message, CODE_450);
		await server.close();
		await open("rcpt-550");
		const permanent = await failure({});
		assert.equal(permanent.retry, false);
	});

	it("a dropped connection and a refused one retry", async () => {
		await open("drop");
		const dropped = await failure({});
		assert.equal(dropped.retry, true);
		await server.close();
		const refused = await failure({});
		assert.equal(refused.retry, true);
	});

	it("scrubs the password a server echoes in its 535 reply", async () => {
		await open("auth-535-echo");
		const err = await failure({ username: "someuser", password: "s3cret-pass-word" });
		assert.equal(err.retry, false);
		assert.doesNotMatch(err.message, PASSWORD);
		assert.match(err.message, STARS);
	});

	it("fails without retry on a self-signed certificate with Verify on", { skip: opensslMissing }, async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npmpro-smtp-"));
		try {
			execFileSync(
				"openssl",
				["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes"].concat([
					"-keyout",
					`${dir}/k.pem`,
					"-out",
					`${dir}/c.pem`,
					"-days",
					"1",
					"-subj",
					"/CN=smtp.test",
				]),
				{ stdio: "ignore" },
			);
			answers.set("smtp.test", [["127.0.0.1"]]);
			await open("accept", {
				tlsOptions: { key: fs.readFileSync(`${dir}/k.pem`), cert: fs.readFileSync(`${dir}/c.pem`) },
			});
			const untrusted = await failure({ host: "smtp.test", security: "tls", verify_tls: true });
			assert.equal(untrusted.retry, false);
			assert.deepEqual(await send({ host: "smtp.test", security: "tls", verify_tls: false }), { ok: true });
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses invalid settings without retry", async () => {
		await open("accept");
		const err = await failure({ port: 0 });
		assert.equal(err.retry, false);
		assert.match(err.message, PORT_INVALID);
		assert.equal(server.messages.length, 0);
	});

	it("refuses a rebinding name on the second send", async () => {
		answers.set("mail.test", [["10.0.0.5"], ["127.0.0.1"]]);
		const values = { ...EMAIL_DEFAULTS, host: "mail.test", from_address: "npm@example.com" };
		assert.equal((await checkSmtpTarget(values)).address, "10.0.0.5");
		const err = await sendMail(values, message, { ehloName: "x" }).then(
			() => null,
			(error) => error,
		);
		assert.equal(err.retry, false);
		assert.match(err.message, NOT_REACH);
	});

	it("retries a resolver outage and fails a missing name", async () => {
		const values = { ...EMAIL_DEFAULTS, host: "dns.test", from_address: "a@b.co" };
		const outcome = () =>
			sendMail(values, message, { ehloName: "x" }).then(
				() => null,
				(error) => error,
			);
		for (const code of ["EAI_AGAIN", "ETIMEOUT", "ESERVFAIL", "ECONNREFUSED"]) {
			answers.set("dns.test", [Object.assign(new Error(code), { code })]);
			const temporary = await outcome();
			assert.equal(temporary.retry, true, code);
			assert.ok(temporary instanceof MailError);
		}
		for (const code of ["ENOTFOUND", "ENODATA"]) {
			answers.set("dns.test", [Object.assign(new Error(code), { code })]);
			assert.equal((await outcome()).retry, false, code);
		}
	});

	it("removes the base64 forms of the login and URL credentials from an error", async () => {
		await open("auth-535-base64");
		const echoed = await failure({ username: "someuser", password: "s3cret-pass-word" });
		assert.equal(echoed.retry, false);
		assert.doesNotMatch(echoed.message, BASE64_PASSWORD);
		await server.close();
		await open("auth-535-url");
		const url = await failure({ username: "someuser", password: "s3cret-pass-word" });
		assert.doesNotMatch(url.message, URL_SECRETS);
		assert.match(url.message, STARS);
	});

	it("logs in with AUTH LOGIN when the transport asks for it", async () => {
		await open("accept");
		const transporter = nodemailer.createTransport({
			host: "127.0.0.1",
			port: server.port,
			ignoreTLS: true,
			authMethod: "LOGIN",
			auth: { user: "loginuser", pass: "login-pass" },
		});
		await transporter.sendMail({ from: "a@b.co", ...message });
		transporter.close();
		assert.deepEqual(server.logins[0], { user: "loginuser", password: "login-pass" });
	});

	it("retries a refused port", async () => {
		const probe = await startFakeSmtp();
		const { port } = probe;
		await probe.close();
		enableLoopbackHook();
		const err = await sendMail(
			{ ...EMAIL_DEFAULTS, host: "127.0.0.1", port, security: "none", from_address: "npm@example.com" },
			message,
			{ ehloName: "x" },
		).then(
			() => null,
			(error) => error,
		);
		assert.equal(err.retry, true);
	});

	it("tries the next checked address after a connect error, never after a reply", async () => {
		await open("accept");
		answers.set("multi.test", [["127.0.0.2", "127.0.0.1"]]);
		assert.deepEqual(await send({ host: "multi.test" }), { ok: true });
		assert.equal(server.messages.length, 1);
		await server.close();
		await open("rcpt-550");
		const refused = await failure({ host: "multi.test" });
		assert.equal(refused.retry, false);
		assert.match(refused.message, CODE_550);
	});

	it("refuses an unresolved name without retry", async () => {
		const err = await sendMail({ ...EMAIL_DEFAULTS, host: "nowhere.test", from_address: "a@b.co" }, message, {
			ehloName: "x",
		}).then(
			() => null,
			(error) => error,
		);
		assert.equal(err.retry, false);
		assert.equal(err.message_i18n, "error.mail-host-unresolved");
	});
});
