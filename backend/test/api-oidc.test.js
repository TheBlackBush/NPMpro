import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { after, before, it, mock } from "node:test";
import { generate } from "otplib";
import { PASSWORD, startApi } from "./support/api.js";
import { setCookie } from "./support/auth.js";
import { fileExists } from "./support/hosts.js";

// /settings/oidc*, /oidc* and the OIDC fields of GET /api (schema/paths/settings/oidc, oidc, wiki/Authentication). The
// identity provider is a mock: discovery, key set and token answers come from the MockAgent of startApi.

const SETTINGS = "/settings/oidc";
const ISSUER = "https://idp.example.com";
const CLIENT = "npmpro-client";
const SECRET = "oidc-client-SECRET-8842";
const DOMAIN = "npm.example.com";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const JPEG = Buffer.from("ffd8ffe000104a4649460001", "hex");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><circle r="1"/></svg>';

let api;
let admin;
let idp;
let keys;
let seen;

const base64url = (value) => Buffer.from(value).toString("base64url");
// one subject per address, as a provider keeps it: a user signs in with the same subject every time
const subOf = (email) => `sub-${String(email).toLowerCase().trim()}`;
const makeKeys = () => {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
	return { privateKey, jwk };
};
const idToken = (claims) => {
	const header = base64url(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
	const now = Math.floor(Date.now() / 1000);
	const payload = base64url(
		JSON.stringify({
			iss: ISSUER,
			aud: CLIENT,
			sub: claims.email ? subOf(claims.email) : randomUUID(),
			iat: now,
			exp: now + 300,
			...claims,
		}),
	);
	const signature = sign("sha256", Buffer.from(`${header}.${payload}`), keys.privateKey).toString("base64url");
	return `${header}.${payload}.${signature}`;
};
const metadata = {
	issuer: ISSUER,
	authorization_endpoint: `${ISSUER}/authorize`,
	token_endpoint: `${ISSUER}/token`,
	jwks_uri: `${ISSUER}/jwks`,
	userinfo_endpoint: `${ISSUER}/userinfo`,
	response_types_supported: ["code"],
	subject_types_supported: ["public"],
	id_token_signing_alg_values_supported: ["RS256"],
};
// the identity provider answers discovery, its keys and the token request (which hands out the id token set in `seen`)
const mockProvider = () => {
	const provider = api.outside.http.get(ISSUER);
	provider.intercept({ path: "/.well-known/openid-configuration", method: "GET" }).reply(200, metadata).persist();
	provider
		.intercept({ path: "/jwks", method: "GET" })
		.reply(200, { keys: [keys.jwk] })
		.persist();
	provider
		.intercept({ path: "/token", method: "POST" })
		.reply(200, () => ({ access_token: "at", token_type: "Bearer", id_token: seen.idToken }))
		.persist();
	provider
		.intercept({ path: "/userinfo", method: "GET" })
		.reply(200, () => seen.userinfo)
		.persist();
};
const configure = async (extra = {}) => {
	const done = await admin.put(SETTINGS, {
		enabled: true,
		issuer_url: ISSUER,
		client_id: CLIENT,
		client_secret: SECRET,
		redirect_domain: DOMAIN,
		...extra,
	});
	assert.equal(done.status, 200, done.text);
	return done.body;
};
const settings = async () => (await admin.get(SETTINGS)).body;
const storedMeta = async () => {
	const row = await api.db("setting").where({ id: "oidc" }).first();
	return typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
};
const upload = (session, bytes, name = "icon.png", type = "image/png") => {
	const form = new FormData();
	form.append("file", new Blob([bytes], { type }), name);
	return session.send("POST", `${SETTINGS}/icon`, { form });
};
const authorizeParams = (location) => new URL(location).searchParams;
// starts a login on a client of its own and returns it with the state and nonce the provider is asked to repeat
const startLogin = async () => {
	const browser = api.client();
	const started = await browser.send("GET", "/oidc", { redirect: "manual" });
	assert.equal(started.status, 302, started.text);
	const params = authorizeParams(started.headers.get("location"));
	return { browser, started, params };
};
const finishLogin = (browser, state, redirect = "manual") =>
	browser.send("GET", `/oidc/callback?code=abc&state=${encodeURIComponent(state)}`, { redirect });
const errorOf = (response) => new URL(response.headers.get("location"), "http://x").searchParams.get("oidc_error");

before(async () => {
	api = await startApi();
	admin = await api.admin();
	keys = makeKeys();
	seen = { idToken: "", userinfo: {} };
});
after(() => api?.stop());

it("tells the sign-in page that OIDC is off with the default button, and the password login is on", async () => {
	const health = await api.client().get("");
	assert.equal(health.status, 200);
	assert.equal(health.body.status, "OK");
	assert.equal(health.body.setup, true);
	assert.equal(health.body.password, true);
	assert.deepEqual(health.body.oidc, {
		active: false,
		label: "OIDC",
		color: "#206bc4",
		icon: { type: "builtin", name: "key" },
	});
});

it("shows the default OIDC settings without a client secret", async () => {
	const view = await settings();
	assert.equal(view.enabled, false);
	assert.equal(view.active, false);
	assert.equal(view.issuer_url, "");
	assert.equal(view.client_secret_set, false);
	assert.equal(view.callback_url, "");
	assert.equal(view.scopes, "openid email profile");
	assert.equal(view.require_verified_email, true);
	assert.equal(view.disable_password, false);
	assert.deepEqual(view.locked, []);
	assert.deepEqual(view.locked_by, {});
	assert.equal(view.session_auth_method, "password");
	assert.equal(view.secret_error, false);
	assert.equal(view.auto_create.enabled, false);
	assert.equal(view.auto_create.permissions.proxy_hosts, "view");
	assert.equal("client_secret" in view, false);
});

it("answers the connection test with a message while issuer and client are missing", async () => {
	const done = await admin.post(`${SETTINGS}/test`, {});
	assert.equal(done.status, 200, done.text);
	assert.deepEqual(done.body, { ok: false, message: "Issuer URL and client ID are required" });
});

it("refuses invalid OIDC settings with 400", async () => {
	for (const body of [
		{},
		{ extra: 1 },
		{ issuer_url: "http://idp.example.com" },
		{ issuer_url: "https://" },
		{ redirect_domain: "https://npm.example.com" },
		{ redirect_domain: "npm.example.com/path" },
		{ scopes: "email profile" },
		{ scopes: "openid\nemail" },
		{ enabled: "yes" },
		{ client_id: "x".repeat(256) },
		{ button: { label: "" } },
		{ button: { color: "blue" } },
		{ button: { icon: { type: "builtin", name: "skull" } } },
		{ button: { icon: { type: "file", name: "key" } } },
		{ auto_create: { allowed_domains: ["not a domain"] } },
		{ auto_create: { permissions: { proxy_hosts: "root" } } },
		{ auto_create: { extra: true } },
	]) {
		const done = await admin.put(SETTINGS, body);
		assert.equal(done.status, 400, JSON.stringify(body));
	}
	assert.equal((await api.db("setting").where({ id: "oidc" }).first()) ?? null, null);
});

it("saves the settings: the secret is stored encrypted and never returned, the callback URL is shown", async () => {
	const view = await configure({
		scopes: "openid email",
		button: { label: "Company login", color: "#123abc", icon: { type: "builtin", name: "brand-github" } },
	});
	assert.equal(view.enabled, true);
	assert.equal(view.active, true);
	assert.equal(view.issuer_url, ISSUER);
	assert.equal(view.client_id, CLIENT);
	assert.equal(view.client_secret_set, true);
	assert.equal(view.callback_url, `https://${DOMAIN}/api/oidc/callback`);
	assert.equal(JSON.stringify(view).includes(SECRET), false);
	assert.equal((await admin.get(SETTINGS)).text.includes(SECRET), false);
	const meta = await storedMeta();
	assert.match(meta.client_secret, /^v1:/u);
	assert.equal(JSON.stringify(meta).includes(SECRET), false);
	const audit = await api.db("audit_log").where({ object_type: "setting" }).orderBy("id", "desc").first();
	assert.equal(audit.action, "updated");
	assert.equal(audit.meta.includes(SECRET), false);
	assert.equal(JSON.parse(audit.meta).id, "oidc");

	const health = await api.client().get("");
	assert.equal(health.body.oidc.active, true);
	assert.equal(health.body.oidc.label, "Company login");
	assert.equal(health.body.oidc.color, "#123abc");
	assert.deepEqual(health.body.oidc.icon, { type: "builtin", name: "brand-github" });
	assert.equal("client_secret" in health.body.oidc, false);
});

it("keeps the secret when the field is empty, and asks for it again when the issuer or client changes", async () => {
	const before_ = (await storedMeta()).client_secret;
	const kept = await admin.put(SETTINGS, { client_secret: "", label: undefined, require_verified_email: false });
	assert.equal(kept.status, 200, kept.text);
	assert.equal((await storedMeta()).client_secret, before_);
	assert.equal(kept.body.require_verified_email, false);
	for (const body of [{ issuer_url: "https://other.example.com" }, { client_id: "another" }]) {
		const done = await admin.put(SETTINGS, body);
		assert.equal(done.status, 400, done.text);
		assert.equal(done.body.error.message_i18n, "error.oidc-secret-required");
	}
	assert.equal((await settings()).issuer_url, ISSUER);
	const moved = await admin.put(SETTINGS, { client_id: "another", client_secret: "second-secret" });
	assert.equal(moved.status, 200, moved.text);
	assert.notEqual((await storedMeta()).client_secret, before_);
	await admin.put(SETTINGS, { client_id: CLIENT, client_secret: SECRET });
	await admin.put(SETTINGS, { require_verified_email: true });
});

it("refuses to disable password login from a session that did not sign in with OIDC", async () => {
	const done = await admin.put(SETTINGS, { disable_password: true });
	assert.equal(done.status, 400, done.text);
	assert.equal(done.body.error.message_i18n, "error.oidc-disable-password-session");
	assert.equal((await settings()).disable_password, false);
	assert.equal((await api.client().get("")).body.password, true);
});

it("refuses default permissions that hide what a visible host needs", async () => {
	const hiddenLists = await admin.put(SETTINGS, { auto_create: { permissions: { access_lists: "hidden" } } });
	assert.equal(hiddenLists.status, 400, hiddenLists.text);
	assert.match(hiddenLists.body.error.message, /Access lists can not be hidden/u);
	const hiddenCerts = await admin.put(SETTINGS, { auto_create: { permissions: { certificates: "hidden" } } });
	assert.equal(hiddenCerts.status, 400);
	assert.match(hiddenCerts.body.error.message, /Certificates can not be hidden/u);
	assert.equal((await settings()).auto_create.permissions.access_lists, "view");
});

it("ignores a field the environment sets and reports it as locked", async () => {
	process.env.OIDC_SKIP_MFA = "true";
	try {
		const view = await settings();
		assert.ok(view.locked.includes("skip_mfa"));
		assert.equal(view.locked_by.skip_mfa, "OIDC_SKIP_MFA");
		assert.equal(view.skip_mfa, true);
		const done = await admin.put(SETTINGS, { skip_mfa: false, scopes: "openid email profile groups" });
		assert.equal(done.status, 200, done.text);
		assert.equal(done.body.skip_mfa, true);
		assert.equal(done.body.scopes, "openid email profile groups");
		assert.equal((await storedMeta()).skip_mfa, undefined);
	} finally {
		delete process.env.OIDC_SKIP_MFA;
	}
	await admin.put(SETTINGS, { scopes: "openid email profile" });
});

it("tests the connection with the discovery of the saved or the submitted values", async () => {
	mockProvider();
	const saved = await admin.post(`${SETTINGS}/test`, {});
	assert.equal(saved.status, 200, saved.text);
	assert.deepEqual(saved.body, { ok: true, issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize` });
	const submitted = await admin.post(`${SETTINGS}/test`, {
		issuer_url: ISSUER,
		client_id: "someone",
		client_secret: "x",
	});
	assert.equal(submitted.body.ok, true);

	const down = api.outside.http.get("https://down.example.com");
	down.intercept({ path: "/.well-known/openid-configuration", method: "GET" }).reply(500, "broken");
	const failed = await admin.post(`${SETTINGS}/test`, { issuer_url: "https://down.example.com", client_secret: "x" });
	assert.equal(failed.status, 200, failed.text);
	assert.equal(failed.body.ok, false);
	assert.equal(typeof failed.body.message, "string");
	assert.equal(failed.text.includes(SECRET), false);

	assert.equal((await admin.post(`${SETTINGS}/test`, { issuer_url: "http://idp.example.com" })).status, 400);
	assert.equal((await admin.post(`${SETTINGS}/test`, { extra: 1 })).status, 400);
});

it("stores an uploaded icon, serves it publicly and shows its URL on the sign-in page", async () => {
	for (const [bytes, name, type, mime] of [
		[PNG, "icon.png", "image/png", "image/png"],
		[JPEG, "icon.jpg", "image/jpeg", "image/jpeg"],
		[WEBP, "icon.webp", "image/webp", "image/webp"],
	]) {
		const done = await upload(admin, bytes, name, type);
		assert.equal(done.status, 200, `${name}: ${done.text}`);
		assert.equal(done.body.button.icon.type, "file");
		const served = await api.client().get("/oidc/icon");
		assert.equal(served.status, 200, name);
		assert.equal(served.headers.get("content-type"), mime);
		assert.equal(served.headers.get("x-content-type-options"), "nosniff");
		assert.match(served.headers.get("cache-control"), /max-age=86400/u);
		assert.deepEqual(served.bytes, bytes);
		assert.equal(served.headers.get("content-security-policy"), null);
	}
	// only the file of the last type stays
	assert.equal(await fileExists(api, "data/npmpro/oidc-icon.webp"), true);
	assert.equal(await fileExists(api, "data/npmpro/oidc-icon.png"), false);
	assert.equal(await fileExists(api, "data/npmpro/oidc-icon.jpg"), false);

	const svg = await upload(admin, Buffer.from(SVG), "icon.svg", "image/svg+xml");
	assert.equal(svg.status, 200, svg.text);
	const served = await api.client().get("/oidc/icon");
	assert.equal(served.headers.get("content-type"), "image/svg+xml");
	assert.equal(served.headers.get("content-security-policy"), "default-src 'none'; style-src 'unsafe-inline'");
	assert.equal(served.headers.get("content-disposition"), "inline");
	assert.equal(served.text, SVG);

	const health = await api.client().get("");
	assert.equal(health.body.oidc.icon.type, "file");
	assert.match(health.body.oidc.icon.url, /^\/api\/oidc\/icon\?v=\d+$/u);
	const audit = await api.db("audit_log").where({ object_type: "setting" }).orderBy("id", "desc").first();
	assert.deepEqual(JSON.parse(audit.meta), { id: "oidc", icon: "uploaded" });
});

it("refuses icons that are the wrong type, too large, unsafe or missing", async () => {
	const stored = await storedMeta();
	const unsafe = [
		'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
		'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
		'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example.com/x.png"/></svg>',
		'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>',
	];
	for (const text of unsafe) {
		const done = await upload(admin, Buffer.from(text), "x.svg", "image/svg+xml");
		assert.equal(done.status, 400, text);
		assert.match(done.body.error.message, /SVG with scripts/u);
	}
	const text = await upload(admin, Buffer.from("just text"), "x.txt", "text/plain");
	assert.equal(text.status, 400);
	assert.match(text.body.error.message, /Unsupported icon type/u);
	const gif = await upload(admin, Buffer.from("GIF89a000000"), "x.gif", "image/gif");
	assert.equal(gif.status, 400);
	const large = await upload(admin, Buffer.concat([PNG, Buffer.alloc(256 * 1024)]));
	assert.equal(large.status, 400);
	assert.match(large.body.error.message, /too large/u);
	const none = await admin.send("POST", `${SETTINGS}/icon`, { form: new FormData() });
	assert.equal(none.status, 400, none.text);
	assert.match(none.body.error.message, /No icon file/u);
	assert.deepEqual((await storedMeta()).button.icon.type, stored.button.icon.type);
	assert.equal((await api.client().get("/oidc/icon")).text, SVG);
});

it("refuses an icon download from a URL that is not http, or points at this host, link-local or multicast addresses", async () => {
	api.outside.dns.set("metadata.example.com", "169.254.169.254");
	api.outside.dns.set("self.example.com", "127.0.0.1");
	const blocked = [
		"http://127.0.0.1/icon.png",
		"http://127.0.0.1:81/icon.png",
		"http://[::1]/icon.png",
		"http://169.254.169.254/latest/meta-data",
		"http://0.0.0.0/icon.png",
		"http://224.0.0.1/icon.png",
		"http://[::ffff:127.0.0.1]/icon.png",
		"http://[fe80::1]/icon.png",
		"https://metadata.example.com/icon.png",
		"https://self.example.com/icon.png",
	];
	for (const url of blocked) {
		const done = await admin.post(`${SETTINGS}/icon/url`, { url });
		assert.equal(done.status, 400, `${url}: ${done.text}`);
		assert.match(done.body.error.message, /address is not allowed/u, url);
	}
	for (const url of ["ftp://example.com/icon.png", "file:///etc/passwd", "javascript:alert(1)"]) {
		const done = await admin.post(`${SETTINGS}/icon/url`, { url });
		assert.equal(done.status, 400, url);
	}
	const unreachable = await admin.post(`${SETTINGS}/icon/url`, { url: "https://nowhere.example.com/icon.png" });
	assert.equal(unreachable.status, 400);
	assert.match(unreachable.body.error.message, /could not connect/u);
	for (const body of [{}, { url: "" }, { url: "not a url" }, { url: "https://a.example.com", extra: 1 }]) {
		assert.equal((await admin.post(`${SETTINGS}/icon/url`, body)).status, 400, JSON.stringify(body));
	}
	assert.equal((await api.client().get("/oidc/icon")).text, SVG);
});

it("removes the icon file and falls back to the builtin icon", async () => {
	const done = await admin.delete(`${SETTINGS}/icon`);
	assert.equal(done.status, 200, done.text);
	assert.deepEqual(done.body.button.icon, { type: "builtin", name: "key" });
	assert.equal(await fileExists(api, "data/npmpro/oidc-icon.svg"), false);
	assert.equal((await api.client().get("/oidc/icon")).status, 404);
	assert.deepEqual((await api.client().get("")).body.oidc.icon, { type: "builtin", name: "key" });
	// a second delete is harmless
	assert.equal((await admin.delete(`${SETTINGS}/icon`)).status, 200);
});

it("starts a login with PKCE, state and nonce, and keeps them in signed cookies", async () => {
	mockProvider();
	const { browser, started, params } = await startLogin();
	assert.match(started.headers.get("location"), /^https:\/\/idp\.example\.com\/authorize\?/u);
	assert.equal(params.get("client_id"), CLIENT);
	assert.equal(params.get("response_type"), "code");
	assert.equal(params.get("redirect_uri"), `https://${DOMAIN}/api/oidc/callback`);
	assert.equal(params.get("scope"), "openid email profile");
	assert.equal(params.get("code_challenge_method"), "S256");
	assert.ok(params.get("code_challenge"));
	assert.ok(params.get("state"));
	assert.ok(params.get("nonce"));
	for (const name of ["code_verifier", "state", "nonce"]) {
		const line = setCookie(started, `__Host-Http-npmpro_oidc_${name}`);
		assert.match(line, /HttpOnly/iu, name);
		assert.match(line, /Secure/iu, name);
		assert.match(line, /SameSite=Lax/iu, name);
		assert.match(line, new RegExp(`${name}=s%3A`, "u"), `${name} is signed`);
	}
	assert.ok(setCookie(started, "__Host-npmpro_oidc_no_redirect"));
	assert.equal(browser.jar.size, 4);
	// each login has its own state
	const again = await startLogin();
	assert.notEqual(again.params.get("state"), params.get("state"));
});

it("refuses a callback without a started login, with a wrong state or with a wrong nonce", async () => {
	const noFlow = await finishLogin(api.client(), "whatever");
	assert.equal(noFlow.status, 302);
	assert.equal(errorOf(noFlow), "provider_error");
	assert.ok(setCookie(noFlow, "__Host-npmpro_oidc_no_redirect"));

	const { browser } = await startLogin();
	const wrongState = await finishLogin(browser, "tampered-state");
	assert.equal(wrongState.status, 302);
	assert.equal(errorOf(wrongState), "provider_error");
	assert.equal(setCookie(wrongState, "__Host-Http-token"), undefined);

	// the right state, but an id token for another nonce
	const second = await startLogin();
	seen.idToken = idToken({ nonce: "not-the-nonce", email: "mallory@example.com", email_verified: true });
	const wrongNonce = await finishLogin(second.browser, second.params.get("state"));
	assert.equal(errorOf(wrongNonce), "provider_error");
	assert.equal(setCookie(wrongNonce, "__Host-Http-token"), undefined);
	assert.equal((await second.browser.get("/users/me")).status, 401);
});

it("refuses a login for a user that does not exist while auto creation is off, and for claims without a verified email", async () => {
	const unknown = await startLogin();
	seen.idToken = idToken({ nonce: unknown.params.get("nonce"), email: "stranger@example.com", email_verified: true });
	const noUser = await finishLogin(unknown.browser, unknown.params.get("state"));
	assert.equal(errorOf(noUser), "no_user");
	assert.equal(setCookie(noUser, "__Host-Http-token"), undefined);

	const unverified = await startLogin();
	seen.idToken = idToken({
		nonce: unverified.params.get("nonce"),
		email: "admin@example.com",
		email_verified: false,
	});
	assert.equal(errorOf(await finishLogin(unverified.browser, unverified.params.get("state"))), "email_not_verified");

	const noEmail = await startLogin();
	const sub = randomUUID();
	seen.idToken = idToken({ nonce: noEmail.params.get("nonce"), sub });
	seen.userinfo = { sub };
	assert.equal(errorOf(await finishLogin(noEmail.browser, noEmail.params.get("state"))), "no_email");
});

it("signs a known user in with the claims of the provider and marks the session as OIDC", async () => {
	const login = await startLogin();
	seen.idToken = idToken({
		nonce: login.params.get("nonce"),
		email: "Admin@Example.com",
		email_verified: true,
	});
	const done = await finishLogin(login.browser, login.params.get("state"));
	assert.equal(done.status, 302, done.text);
	assert.equal(done.headers.get("location"), "/");
	const cookie = setCookie(done, "__Host-Http-token");
	assert.match(cookie, /HttpOnly/iu);
	assert.match(cookie, /SameSite=Strict/iu);
	// the flow cookies are gone and the session works
	assert.equal(login.browser.jar.has("__Host-Http-npmpro_oidc_state"), false);
	const me = await login.browser.get("/users/me");
	assert.equal(me.status, 200, me.text);
	assert.equal(me.body.email, "admin@example.com");
	assert.equal((await login.browser.get(SETTINGS)).body.session_auth_method, "oidc");
	// a state is good for one login only
	const replay = await finishLogin(login.browser, login.params.get("state"));
	assert.equal(errorOf(replay), "provider_error");
});

it("reads the email from the user info when the id token has none", async () => {
	const login = await startLogin();
	const sub = subOf("admin@example.com");
	seen.idToken = idToken({ nonce: login.params.get("nonce"), sub });
	seen.userinfo = { sub, email: "admin@example.com", email_verified: true };
	const done = await finishLogin(login.browser, login.params.get("state"));
	assert.equal(done.headers.get("location"), "/");
	assert.equal((await login.browser.get("/users/me")).status, 200);
});

it("creates a user on the first login when auto creation allows the domain, with the default permissions", async () => {
	await admin.put(SETTINGS, {
		auto_create: {
			enabled: true,
			allowed_domains: ["Example.org", "example.org", "partner.example.net"],
			permissions: { proxy_hosts: "manage", visibility: "all" },
		},
	});
	assert.deepEqual((await settings()).auto_create.allowed_domains, ["example.org", "partner.example.net"]);

	const outsider = await startLogin();
	seen.idToken = idToken({
		nonce: outsider.params.get("nonce"),
		email: "eve@other.example.com",
		email_verified: true,
	});
	assert.equal(errorOf(await finishLogin(outsider.browser, outsider.params.get("state"))), "domain_not_allowed");
	assert.equal(await api.db("user").where({ email: "eve@other.example.com" }).first(), undefined);

	const login = await startLogin();
	seen.idToken = idToken({
		nonce: login.params.get("nonce"),
		email: "New.Person@example.org",
		email_verified: true,
		name: "New Person",
	});
	const done = await finishLogin(login.browser, login.params.get("state"));
	assert.equal(done.headers.get("location"), "/");
	const user = await api.db("user").where({ email: "new.person@example.org" }).first();
	assert.equal(user.name, "New Person");
	assert.equal(user.is_disabled, 0);
	const permissions = await api.db("user_permission").where({ user_id: user.id }).first();
	assert.equal(permissions.proxy_hosts, "manage");
	assert.equal(permissions.visibility, "all");
	assert.equal(permissions.redirection_hosts, "view");
	const audit = await api.db("audit_log").where({ object_type: "user", object_id: user.id }).first();
	assert.equal(JSON.parse(audit.meta).via, "oidc");
	// the new user is linked to the identity that created it
	assert.equal(user.npmpro_oidc_issuer, ISSUER);
	assert.equal(user.npmpro_oidc_subject, subOf("new.person@example.org"));
	const me = await login.browser.get("/users/me");
	assert.equal(me.body.email, "new.person@example.org");
	// the second login finds the same user
	const again = await startLogin();
	seen.idToken = idToken({ nonce: again.params.get("nonce"), email: "new.person@example.org", email_verified: true });
	assert.equal((await finishLogin(again.browser, again.params.get("state"))).headers.get("location"), "/");
	assert.equal((await api.db("user").where({ email: "new.person@example.org" })).length, 1);
	await admin.put(SETTINGS, { auto_create: { enabled: false } });
});

it("refuses a login for a disabled user", async () => {
	const created = await admin.post("/users", {
		name: "Disabled Person",
		email: "off@example.com",
		roles: [],
		auth: { type: "password", secret: PASSWORD },
	});
	assert.equal(created.status, 201, created.text);
	await api.db("user").where({ id: created.body.id }).update({ is_disabled: 1 });
	const login = await startLogin();
	seen.idToken = idToken({ nonce: login.params.get("nonce"), email: "off@example.com", email_verified: true });
	assert.equal(errorOf(await finishLogin(login.browser, login.params.get("state"))), "user_disabled");
});

it("asks for the second factor of a user who has one, unless the settings skip it", async () => {
	const user = await api.limited({ visibility: "user" });
	const setup = await user.post(`/users/${user.user.id}/mfa/totp`);
	assert.equal(setup.status, 200, setup.text);
	const enabled = await user.post(`/users/${user.user.id}/mfa/totp/enable`, {
		code: await generate({ secret: setup.body.secret }),
	});
	assert.equal(enabled.status, 200, enabled.text);
	// enabling the second factor revokes the tokens of that second: the login must come later
	mock.timers.enable({ apis: ["Date"], now: Date.now() });
	mock.timers.tick(2000);
	try {
		const login = await startLogin();
		seen.idToken = idToken({ nonce: login.params.get("nonce"), email: user.user.email, email_verified: true });
		const challenged = await finishLogin(login.browser, login.params.get("state"));
		assert.equal(challenged.headers.get("location"), "/");
		assert.equal(setCookie(challenged, "__Host-Http-token"), undefined);
		assert.match(setCookie(challenged, "__Host-Http-challenge_token"), /HttpOnly/iu);
		assert.match(setCookie(challenged, "__Host-npmpro_oidc_totp_required"), /Secure/iu);
		assert.equal((await login.browser.get("/users/me")).status, 401);
		// a backup code completes the login
		const done = await login.browser.post("/tokens/totp", { code: enabled.body.backup_codes[0] });
		assert.equal(done.status, 200, done.text);
		assert.equal((await login.browser.get("/users/me")).body.email, user.user.email);

		const skipped = await admin.put(SETTINGS, { skip_mfa: true });
		assert.equal(skipped.status, 200, skipped.text);
		const again = await startLogin();
		seen.idToken = idToken({ nonce: again.params.get("nonce"), email: user.user.email, email_verified: true });
		const direct = await finishLogin(again.browser, again.params.get("state"));
		assert.ok(setCookie(direct, "__Host-Http-token"));
		assert.equal(setCookie(direct, "__Host-Http-challenge_token"), undefined);
	} finally {
		mock.timers.reset();
		await admin.put(SETTINGS, { skip_mfa: false });
	}
});

// a login of `email` with the provider subject `sub`, answered by the callback
const loginAs = async (email, sub) => {
	const login = await startLogin();
	seen.idToken = idToken({ nonce: login.params.get("nonce"), email, email_verified: true, sub });
	return { login, done: await finishLogin(login.browser, login.params.get("state")) };
};
const auditOf = (action, objectId) => api.db("audit_log").where({ action, object_id: objectId }).first();

it("links a user at the first OIDC sign-in, refuses another subject for its email, and links again after an unlink", async () => {
	const created = await admin.post("/users", {
		name: "Linked Person",
		email: "linked@example.com",
		roles: [],
		auth: { type: "password", secret: PASSWORD },
	});
	assert.equal(created.status, 201, created.text);
	const { id } = created.body;

	const first = await loginAs("linked@example.com", "first");
	assert.equal(first.done.headers.get("location"), "/");
	const row = await api.db("user").where({ id }).first();
	assert.equal(row.npmpro_oidc_issuer, ISSUER);
	assert.equal(row.npmpro_oidc_subject, "first");
	assert.ok(row.npmpro_oidc_linked_on);
	assert.equal(JSON.parse((await auditOf("oidc-linked", id)).meta).issuer, ISSUER);

	// the API sends the link date and the password flag, never the issuer or the subject (Review Focus 4)
	const listed = (await admin.get("/users")).body.find((user) => user.id === id);
	assert.equal(listed.npmpro_has_password, true);
	assert.ok(listed.npmpro_oidc_linked_on);
	for (const answer of [
		listed,
		(await admin.get(`/users/${id}`)).body,
		(await first.login.browser.get("/users/me")).body,
	]) {
		assert.equal("npmpro_oidc_subject" in answer, false);
		assert.equal("npmpro_oidc_issuer" in answer, false);
	}

	const other = await loginAs("linked@example.com", "second");
	assert.equal(errorOf(other.done), "identity_mismatch");
	assert.equal(setCookie(other.done, "__Host-Http-token"), undefined);
	assert.ok(await auditOf("oidc-refused", id));

	const user = await api.limited({ visibility: "all" });
	assert.equal((await api.client().delete(`/users/${id}/oidc`)).status, 401);
	assert.equal((await user.delete(`/users/${id}/oidc`)).status, 403);
	assert.equal((await admin.delete("/users/9999/oidc")).status, 404);
	const unlinked = await admin.delete(`/users/${id}/oidc`);
	assert.equal(unlinked.status, 200, unlinked.text);
	assert.equal(unlinked.body, true);
	assert.equal((await api.db("user").where({ id }).first()).npmpro_oidc_subject, null);
	assert.ok(await auditOf("oidc-unlinked", id));
	assert.equal((await admin.get("/users")).body.find((item) => item.id === id).npmpro_oidc_linked_on, null);

	const again = await loginAs("linked@example.com", "second");
	assert.equal(again.done.headers.get("location"), "/");
	assert.equal((await api.db("user").where({ id }).first()).npmpro_oidc_subject, "second");
});

it("refuses a subject that is linked to another user, also for an account auto-create would make (R2)", async () => {
	for (const email of ["holder@example.com", "taker@example.com"]) {
		const created = await admin.post("/users", { name: email, email, roles: [] });
		assert.equal(created.status, 201, created.text);
	}
	assert.equal((await loginAs("holder@example.com", "shared")).done.headers.get("location"), "/");
	assert.equal(errorOf((await loginAs("taker@example.com", "shared")).done), "identity_mismatch");
	assert.equal((await api.db("user").where({ email: "taker@example.com" }).first()).npmpro_oidc_subject, null);

	await admin.put(SETTINGS, { auto_create: { enabled: true, allowed_domains: ["example.org"] } });
	try {
		assert.equal(errorOf((await loginAs("second.account@example.org", "shared")).done), "identity_mismatch");
		assert.equal(await api.db("user").where({ email: "second.account@example.org" }).first(), undefined);
	} finally {
		await admin.put(SETTINGS, { auto_create: { enabled: false } });
	}
	// a user without a password row is listed without the password flag
	const listed = (await admin.get("/users")).body.find((user) => user.email === "holder@example.com");
	assert.equal(listed.npmpro_has_password, false);
});

it("keeps the issuer and subject out of the audit meta of a deleted linked user (Review Focus 4)", async () => {
	const created = await admin.post("/users", { name: "Doomed", email: "doomed@example.com", roles: [] });
	assert.equal(created.status, 201, created.text);
	const { id } = created.body;
	assert.equal((await loginAs("doomed@example.com", "doomed-sub")).done.headers.get("location"), "/");
	assert.equal((await api.db("user").where({ id }).first()).npmpro_oidc_subject, "doomed-sub");

	const removed = await admin.delete(`/users/${id}`);
	assert.equal(removed.status, 200, removed.text);
	const row = await api.db("audit_log").where({ action: "deleted", object_type: "user", object_id: id }).first();
	assert.ok(row);
	const meta = JSON.parse(row.meta);
	assert.equal("npmpro_oidc_subject" in meta, false);
	assert.equal("npmpro_oidc_issuer" in meta, false);
	assert.equal(row.meta.includes("doomed-sub"), false);
});

it("answers OIDC routes with an error code on the sign-in page while OIDC is off or the provider fails", async () => {
	const failing = api.client();
	await admin.put(SETTINGS, { enabled: false });
	const off = await failing.send("GET", "/oidc", { redirect: "manual" });
	assert.equal(off.status, 302);
	assert.equal(errorOf(off), "not_configured");
	assert.ok(setCookie(off, "__Host-npmpro_oidc_no_redirect"));
	assert.equal(errorOf(await finishLogin(api.client(), "x")), "not_configured");
	assert.equal((await api.client().get("")).body.oidc.active, false);

	await admin.put(SETTINGS, { enabled: true, issuer_url: "https://broken.example.com", client_secret: "again" });
	api.outside.http
		.get("https://broken.example.com")
		.intercept({ path: "/.well-known/openid-configuration", method: "GET" })
		.reply(500, "broken");
	const broken = await api.client().send("GET", "/oidc", { redirect: "manual" });
	assert.equal(errorOf(broken), "provider_error");
});

it("limits the OIDC routes, but not the public icon", async () => {
	const limited = api.client();
	let blocked = 0;
	for (let n = 0; n < 12; n += 1) {
		const done = await limited.send("GET", "/oidc/callback?code=a&state=b", { redirect: "manual" });
		if (done.status === 429) blocked += 1;
	}
	assert.ok(blocked >= 1, "the 11th request in 5 minutes is refused");
	for (let n = 0; n < 12; n += 1) {
		assert.notEqual((await limited.get("/oidc/icon")).status, 429);
	}
});

it("answers 401 without a session and 403 for a user who is not an administrator, on every OIDC settings route", async () => {
	const none = api.client();
	const user = await api.limited({ visibility: "all" });
	const routes = [
		["get", SETTINGS],
		["put", SETTINGS, { enabled: false }],
		["post", `${SETTINGS}/test`, {}],
		["delete", `${SETTINGS}/icon`],
		["post", `${SETTINGS}/icon/url`, { url: "https://example.com/icon.png" }],
	];
	for (const [method, url, body] of routes) {
		assert.equal((await none[method](url, body)).status, 401, `${method} ${url}`);
		assert.equal((await user[method](url, body)).status, 403, `${method} ${url}`);
	}
	assert.equal((await none.send("POST", `${SETTINGS}/icon`, { form: new FormData() })).status, 401);
	assert.equal((await upload(user, PNG)).status, 403);
	assert.equal((await upload(none, PNG)).status, 401);
});
