import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkUrlShape, fillUrl, refusalOf, secretsOfUrl } from "../lib/ddns/custom-url.js";
import { scrubSecrets } from "../lib/ddns/errors.js";

const V6 = ["2001", "db8", "", "1"].join("%3A");
const QUERY = ["ip={ip}", "a={ipv4}", "b={ipv6}"].join("&");

describe("checkUrlShape", () => {
	it("accepts https with placeholders in the path and the query", () => {
		for (const url of [
			"https://dyn.example.net/update",
			`https://dyn.example.net/u/{name}?${QUERY}`,
			"https://dyn.example.net:8443/{name}",
		]) {
			assert.ok(checkUrlShape(url).sample, url);
		}
	});

	it("refuses anything else with the key of the refusal", () => {
		const key = (url) => checkUrlShape(url).key;
		assert.equal(key("http://dyn.example.net/x"), "error.ddns-custom-url-https");
		assert.equal(key("ftp://dyn.example.net/x"), "error.ddns-custom-url-https");
		assert.equal(key("dyn.example.net/x"), "error.ddns-custom-url-https");
		assert.equal(key(undefined), "error.ddns-custom-url-https");
		assert.equal(key("https://{name}.example.net/x"), "error.ddns-custom-host-placeholder");
		assert.equal(key("https://dyn.{ip}/x"), "error.ddns-custom-host-placeholder");
		assert.equal(key("https://dyn.example.net:{ip}/x"), "error.ddns-custom-host-placeholder");
		assert.equal(key("https://dyn.example.net/{other}"), "error.ddns-custom-url-invalid");
		assert.equal(key("https://dyn.example.net/{ip"), "error.ddns-custom-url-invalid");
		assert.equal(key("https://dyn.example.net/x#{name}"), "error.ddns-custom-host-placeholder");
		assert.equal(key("https://user:pw@dyn.example.net/x"), "error.ddns-custom-url-invalid");
		assert.equal(key("https:///x"), "error.ddns-custom-url-invalid");
	});
});

describe("refusalOf", () => {
	it("applies the outbound guard to an address host", async () => {
		assert.equal(await refusalOf("https://127.0.0.1/x"), "error.ddns-custom-url-blocked");
		assert.equal(await refusalOf("https://[::1]/x"), "error.ddns-custom-url-blocked");
		assert.equal(await refusalOf("https://203.0.113.9/x"), null);
		assert.equal(await refusalOf("http://203.0.113.9/x"), "error.ddns-custom-url-https");
	});
});

describe("fillUrl", () => {
	it("fills both families when the record has both addresses", () => {
		const template = `https://h.example/?${QUERY}`;
		assert.equal(
			fillUrl(template, {
				ip: "203.0.113.9",
				type: "A",
				name: "n",
				addresses: { ipv4: "203.0.113.9", ipv6: "::1" },
			}),
			"https://h.example/?ip=203.0.113.9&a=203.0.113.9&b=%3A%3A1",
		);
		assert.equal(
			fillUrl(template, { ip: "203.0.113.9", type: "A", name: "n", addresses: { ipv4: "203.0.113.9" } }),
			"https://h.example/?ip=203.0.113.9&a=203.0.113.9&b=",
		);
	});

	it("fills the family's placeholders and URL-encodes every value", () => {
		const template = `https://h.example/u/{name}?${QUERY}`;
		assert.equal(
			fillUrl(template, { ip: "203.0.113.9", type: "A", name: "home.example.com" }),
			"https://h.example/u/home.example.com?ip=203.0.113.9&a=203.0.113.9&b=",
		);
		assert.equal(
			fillUrl(template, { ip: "2001:db8::1", type: "AAAA", name: "a b&c/d.example" }),
			`https://h.example/u/a%20b%26c%2Fd.example?ip=${V6}&a=&b=${V6}`,
		);
	});
});

describe("secretsOfUrl", () => {
	it("covers the whole URL, the host and every literal piece, so a token cannot reach a message", () => {
		const host = "dyn.example.net";
		const inPath = "path-piece";
		const inQuery = "query-piece";
		const secrets = secretsOfUrl(`https://${host}/u/${inPath}/{name}?key=${inQuery}&ip={ip}`);
		const text = `failed https://${host}/u/${inPath}/home?key=${inQuery}&ip=1 and ${inPath} and ${inQuery}`;
		const scrubbed = scrubSecrets(text, secrets);
		for (const word of [inPath, inQuery, host]) assert.ok(!scrubbed.includes(word), word);
		const spelled = secretsOfUrl("https://DYN.Example.NET:8443/x-path");
		for (const form of ["DYN.Example.NET:8443", "dyn.example.net", "dyn.example.net:8443"])
			assert.ok(spelled.includes(form), form);
		assert.deepEqual(secretsOfUrl(""), []);
		assert.deepEqual(secretsOfUrl(null), []);
	});
});
