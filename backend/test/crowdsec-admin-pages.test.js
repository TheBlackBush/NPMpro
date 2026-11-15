import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { scriptHash } from "../landing-pages/build.js";
import { ADMIN_BANS, ADMIN_CHECKED, ADMIN_OUT, captchaCsp, crowdsecFiles } from "../lib/crowdsec/files.js";
import { CROWDSEC_DEFAULTS } from "../lib/crowdsec/settings.js";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const conf = read("rootfs/usr/local/nginx/conf/conf.d/npmpro.conf");
const lua = read("rootfs/usr/local/share/lua/5.1/npmpro_pages.lua");

const CSP_LINE = /more_set_headers "Content-Security-Policy: (?<csp>[^"]+)";/u;
// the text of a location block, from its head to the next line that is a closing brace at two spaces
const block = (head) => {
	const start = conf.indexOf(head);
	if (start === -1) throw new Error(`${head} is missing`);
	return conf.slice(start, conf.indexOf("\n  }\n", start));
};
const cspOf = (head) => block(head).match(CSP_LINE).groups.csp;
const PREVIEW = "location ~ ^/api/settings/(landing-pages/preview/";
const BAN = "location = /.npmpro/crowdsec-ban {";
const CAPTCHA = "location = /.npmpro/crowdsec-captcha {";
const directive = (csp, name) => csp.split("; ").find((part) => part.startsWith(`${name} `));
const adminFile = (values) =>
	crowdsecFiles({ ...CROWDSEC_DEFAULTS, ...values }).find((file) => file.path.endsWith("crowdsec-admin.conf"))
		.content;
const DEFAULT_LINE = /^ {2}set \$npmpro_captcha_csp "(?<csp>[^"]*)";$/mu;
const ADMIN_PAGES = /local ADMIN_PAGES = \{ ban = "(?<ban>[^"]+)", captcha = "(?<captcha>[^"]+)" \}/u;
const EXEC_GUARD = /^\s*if on_admin_ui\(\) then\s*$/mu;
const setLine = /^set \$npmpro_captcha_csp "(?<csp>[^"]*)";\n$/mu;

it("has the two internal locations, each skipping the bouncer and serving its page", () => {
	for (const [head, kind] of [
		[BAN, "ban"],
		[CAPTCHA, "captcha"],
	]) {
		const text = block(head);
		assert.ok(text.includes("\n    internal;\n"), head);
		assert.ok(text.includes("\n    set $npmpro_crowdsec_skip 1;\n"), head);
		assert.ok(text.includes(`require("npmpro_pages").serve("${kind}")`), head);
	}
});

it("gives the ban page the CSP of the landing page previews, with the page script's hash", () => {
	const ban = cspOf(BAN);
	assert.equal(ban, cspOf(PREVIEW));
	assert.ok(ban.includes(`script-src '${scriptHash()}';`));
});

it("keeps the same hash in the provider CSP builder", () => {
	assert.ok(captchaCsp("turnstile").includes(`script-src '${scriptHash()}' `));
});

it("sends the captcha page its own CSP variable, no COEP, and defaults it to the ban page's CSP", () => {
	const text = block(CAPTCHA);
	assert.ok(text.includes('more_set_headers "Content-Security-Policy: $npmpro_captcha_csp";'));
	assert.ok(text.includes('more_set_headers "Cross-Origin-Embedder-Policy: unsafe-none";'));
	const defaults = conf.match(DEFAULT_LINE).groups.csp;
	assert.equal(defaults, cspOf(BAN));
	// the default is set before the include that may replace it
	assert.ok(
		conf.indexOf("set $npmpro_captcha_csp") < conf.indexOf("include /data/npmpro/nginx/crowdsec-admin.conf;"),
	);
});

const PROVIDERS = {
	recaptcha: { frontend: "https://www.recaptcha.net", others: ["hcaptcha.com", "cloudflare.com"] },
	hcaptcha: { frontend: "https://js.hcaptcha.com", others: ["recaptcha.net", "gstatic.com", "cloudflare.com"] },
	turnstile: {
		frontend: "https://challenges.cloudflare.com",
		others: ["recaptcha.net", "gstatic.com", "hcaptcha.com"],
	},
};

for (const [provider, { frontend, others }] of Object.entries(PROVIDERS)) {
	it(`allows only the ${provider} origins on the captcha page`, () => {
		const csp = captchaCsp(provider);
		assert.ok(directive(csp, "script-src").includes(frontend), csp);
		assert.ok(directive(csp, "frame-src"), csp);
		assert.ok(csp.includes("form-action 'self'"));
		assert.ok(!csp.includes("sandbox"));
		assert.ok(csp.startsWith("default-src 'none'; "));
		for (const other of others) assert.ok(!csp.includes(other), `${provider} CSP names ${other}`);
		// the file the backend writes carries it, after the admin UI choice
		assert.equal(adminFile({ captcha_provider: provider }).match(setLine).groups.csp, csp);
	});
}

it("writes no captcha line without a provider, and one for each admin UI choice with a provider", () => {
	assert.equal(captchaCsp(""), null);
	assert.equal(captchaCsp(undefined), null);
	assert.equal(adminFile({ captcha_provider: "" }), ADMIN_CHECKED);
	assert.equal(adminFile({ admin_ui: "bans" }), ADMIN_BANS);
	assert.equal(adminFile({ admin_ui: "out" }), ADMIN_OUT);
	for (const [choice, head] of [
		["checked", ADMIN_CHECKED],
		["bans", ADMIN_BANS],
		["out", ADMIN_OUT],
	]) {
		const content = adminFile({ admin_ui: choice, captcha_provider: "hcaptcha" });
		assert.ok(content.startsWith(head), choice);
		assert.match(content, setLine);
		assert.equal(content.split("\n").length, head.split("\n").length + 1);
	}
});

it("sends the pages from the lua wrapper to the two locations, only on the admin UI", () => {
	const pages = lua.match(ADMIN_PAGES).groups;
	assert.deepEqual({ ...pages }, { ban: "/.npmpro/crowdsec-ban", captcha: "/.npmpro/crowdsec-captcha" });
	for (const location of Object.values(pages)) assert.ok(conf.includes(`location = ${location} {`), location);
	const uses = [...lua.matchAll(/ngx\.exec\(/gu)];
	assert.equal(uses.length, 2);
	for (const use of uses) {
		const before = lua.slice(0, use.index);
		assert.match(before.slice(before.lastIndexOf("\n", before.lastIndexOf("if ")) + 1), EXEC_GUARD);
	}
	assert.ok(lua.includes('return ngx.var.npmpro_host_id == "npmpro"'));
	assert.ok(conf.includes("set $npmpro_host_id npmpro;"));
});

it("keeps the strict CSP of the admin UI's own pages", () => {
	const strict =
		"default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests; require-trusted-types-for 'script'; trusted-types 'none'; sandbox;";
	const index =
		"default-src 'none'; script-src-elem 'self'; style-src-elem 'self'; connect-src 'self'; font-src 'self'; img-src 'self' data:; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests;";
	assert.equal(cspOf("location / {"), strict);
	assert.equal(cspOf("location = /index.html {"), index);
	assert.equal(cspOf("location /assets/ {"), strict);
	assert.ok(cspOf("location / {").endsWith("sandbox;"));
});
