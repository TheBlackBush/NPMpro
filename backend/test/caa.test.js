import assert from "node:assert/strict";
import { it } from "node:test";
import { evaluateCaa } from "../lib/dns-check/caa.js";
import { checkCaaNames, findCaaSet } from "../lib/dns-check/caa-lookup.js";

const LE = ["letsencrypt.org"];
const HTTP_ONLY = /validationmethods=http-01/u;
const rec = (tag, value, critical = 0) => ({ critical, type: "CAA", [tag]: value });
const judge = (records, extra = {}) =>
	evaluateCaa({ name: "app.example.com", records, identities: LE, method: "dns-01", ...extra });

it("no set anywhere allows every CA (RFC 8659 section 3)", () => {
	assert.deepEqual(judge([]), { state: "allowed", reason: "none", record: null });
	assert.equal(judge(undefined).state, "allowed");
});

it("issue letsencrypt.org allows Let's Encrypt and refuses Google", () => {
	const records = [rec("issue", "letsencrypt.org")];
	assert.equal(judge(records).state, "allowed");
	assert.equal(judge(records).reason, "listed");
	const google = judge(records, { identities: ["pki.goog"] });
	assert.equal(google.state, "refused");
	assert.equal(google.reason, "not-listed");
	assert.equal(google.record, '0 issue "letsencrypt.org"');
});

it("the issuer compares case-insensitively and any identity of the CA counts", () => {
	assert.equal(judge([rec("issue", " LetsEncrypt.ORG. ")]).state, "allowed");
	assert.equal(
		judge([rec("issue", "sectigo.com")], { identities: ["trust-provider.com", "sectigo.com"] }).state,
		"allowed",
	);
	assert.equal(judge([rec("ISSUE", "letsencrypt.org")]).state, "allowed");
});

it('issue ";" refuses every CA', () => {
	const refused = judge([rec("issue", ";")]);
	assert.equal(refused.state, "refused");
	assert.equal(refused.reason, "forbidden");
	// an empty value beside a listed one equals the listed one (additive)
	assert.equal(judge([rec("issue", ";"), rec("issue", "letsencrypt.org")]).state, "allowed");
});

it("a wildcard with issuewild present uses it only", () => {
	const records = [rec("issue", "letsencrypt.org"), rec("issuewild", "pki.goog")];
	assert.equal(judge(records, { name: "*.example.com" }).state, "refused");
	assert.equal(judge(records, { name: "*.example.com", identities: ["pki.goog"] }).state, "allowed");
});

it("a wildcard without issuewild uses issue", () => {
	assert.equal(judge([rec("issue", "letsencrypt.org")], { name: "*.example.com" }).state, "allowed");
	assert.equal(judge([rec("issue", "pki.goog")], { name: "*.example.com" }).state, "refused");
});

it("issuewild ; refuses the wildcard but not the plain name", () => {
	const records = [rec("issue", "letsencrypt.org"), rec("issuewild", ";")];
	assert.equal(judge(records, { name: "*.example.com" }).state, "refused");
	assert.equal(judge(records, { name: "example.com" }).state, "allowed");
});

it("issuewild is ignored for a plain name", () => {
	assert.equal(judge([rec("issuewild", "pki.goog")]).state, "allowed");
	assert.equal(judge([rec("issuewild", "pki.goog")]).reason, "no-issue-property");
});

it("validationmethods without the request's method refuses (RFC 8657)", () => {
	const records = [rec("issue", "letsencrypt.org; validationmethods=http-01")];
	const dns = judge(records);
	assert.equal(dns.state, "refused");
	assert.equal(dns.reason, "validationmethods");
	assert.equal(judge(records, { method: "http-01" }).state, "allowed");
	assert.equal(judge([rec("issue", "letsencrypt.org; validationmethods=http-01,dns-01")]).state, "allowed");
});

it("accounturi gives limited", () => {
	const limited = judge([rec("issue", "letsencrypt.org; accounturi=https://acme.example/acct/1")]);
	assert.equal(limited.state, "limited");
	assert.equal(limited.reason, "accounturi");
	// another, unrestricted property of the same CA wins
	assert.equal(
		judge([rec("issue", "letsencrypt.org; accounturi=https://x/1"), rec("issue", "letsencrypt.org")]).state,
		"allowed",
	);
});

it("the two parameters are shown and not compared for a CA that is not known to honour them", () => {
	const off = judge([rec("issue", "letsencrypt.org; validationmethods=http-01")], { parameters: false });
	assert.equal(off.state, "allowed");
	assert.equal(off.reason, "listed-parameters-unchecked");
	assert.match(off.record, HTTP_ONLY);
	assert.equal(
		judge([rec("issue", "letsencrypt.org; accounturi=https://x/1")], { parameters: false }).state,
		"allowed",
	);
});

it("an unknown tag with the critical flag refuses; without it the tag is ignored", () => {
	const critical = judge([rec("issue", "letsencrypt.org"), rec("futuretag", "x", 128)]);
	assert.equal(critical.state, "refused");
	assert.equal(critical.reason, "critical-unknown-tag");
	assert.equal(critical.record, '128 futuretag "x"');
	assert.equal(judge([rec("issue", "letsencrypt.org"), rec("futuretag", "x", 0)]).state, "allowed");
	// a known tag with the flag is fine
	assert.equal(judge([rec("issue", "letsencrypt.org", 128)]).state, "allowed");
});

it("iodef only is allowed: no issue property means any CA may issue (RFC 8659)", () => {
	const result = judge([rec("iodef", "mailto:security@example.com")]);
	assert.equal(result.state, "allowed");
	assert.equal(result.reason, "no-issue-property");
});

const answers = (map) => (name) => {
	const found = map[name];
	if (found === undefined) return { ok: false, code: "nxdomain" };
	if (found.code) return { ok: false, code: found.code };
	return found.length === 0 ? { ok: false, code: "nodata" } : { ok: true, values: found };
};

it("a set at the parent is found at the parent", async () => {
	const lookup = answers({ "example.com": [rec("issue", "letsencrypt.org")] });
	const set = await findCaaSet("a.b.example.com", lookup);
	assert.equal(set.ok, true);
	assert.equal(set.at, "example.com");
	assert.equal(set.records.length, 1);
});

it("a wildcard starts at its base name", async () => {
	const asked = [];
	await findCaaSet("*.example.com", (name) => {
		asked.push(name);
		return { ok: false, code: "nodata" };
	});
	assert.deepEqual(asked, ["example.com", "com"]);
});

it("no set anywhere answers an empty set; a NODATA and an NXDOMAIN move up", async () => {
	const lookup = answers({ "a.example.com": [], "example.com": { code: "nxdomain" } });
	assert.deepEqual(await findCaaSet("a.example.com", lookup), { ok: true, at: null, records: [] });
});

it("a SERVFAIL stops the climb with its code", async () => {
	const asked = [];
	const lookup = (name) => {
		asked.push(name);
		return name === "a.example.com" ? { ok: false, code: "nodata" } : { ok: false, code: "servfail" };
	};
	assert.deepEqual(await findCaaSet("a.example.com", lookup), { ok: false, code: "servfail" });
	assert.deepEqual(asked, ["a.example.com", "example.com"]);
});

it("the climb stops at the first non-empty set, not at the first answer of any type", async () => {
	const lookup = answers({
		"a.example.com": [],
		"example.com": [rec("issue", "pki.goog")],
		com: [rec("issue", "letsencrypt.org")],
	});
	assert.equal((await findCaaSet("a.example.com", lookup)).at, "example.com");
});

it("the climb is capped at 10 levels", async () => {
	const asked = [];
	const name = Array.from({ length: 14 }, (_, i) => `l${i}`).join(".");
	await findCaaSet(name, (level) => {
		asked.push(level);
		return { ok: false, code: "nodata" };
	});
	assert.equal(asked.length, 10);
});

it("checkCaaNames: a state per name, a failing lookup is unknown, a pattern name is not checked", async () => {
	const lookup = (name) => {
		if (name === "bad.test" || name === "test") return { ok: false, code: "timeout" };
		if (name === "example.com") return { ok: true, values: [rec("issue", "pki.goog")] };
		return { ok: false, code: "nodata" };
	};
	const results = await checkCaaNames({
		names: ["www.example.com", "bad.test", "~^a\\.example\\.com$", "free.org"],
		identities: LE,
		method: "http-01",
		parameters: true,
		lookup,
	});
	assert.deepEqual(
		results.map((result) => [result.name, result.state, result.reason, result.found_at]),
		[
			["www.example.com", "refused", "not-listed", "example.com"],
			["bad.test", "unknown", "lookup-timeout", null],
			["~^a\\.example\\.com$", "not-checked", "skipped-pattern", null],
			["free.org", "allowed", "none", null],
		],
	);
});
