import assert from "node:assert/strict";
import dns from "node:dns";
import { afterEach, describe, it } from "node:test";
import { checkWebhookTarget, urlHint, validateWebhookUrl } from "../lib/notify/webhook-url.js";

const PARTIAL = /%[0-9A-Fa-f]?$/u;
const realLookup = dns.lookup;
const answer = (list) => {
	dns.lookup = (_host, _options, callback) =>
		list instanceof Error
			? callback(list)
			: callback(
					null,
					list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
				);
};
afterEach(() => {
	dns.lookup = realLookup;
});

describe("validateWebhookUrl", () => {
	it("accepts https for any host and http marked private only", () => {
		assert.deepEqual(validateWebhookUrl("https://hooks.example.com/a"), {
			url: "https://hooks.example.com/a",
			privateOnly: false,
		});
		assert.deepEqual(validateWebhookUrl("http://192.168.1.5/x"), {
			url: "http://192.168.1.5/x",
			privateOnly: true,
		});
	});

	it("refuses user info, other schemes, junk and long text", () => {
		assert.equal(validateWebhookUrl(["https://user", "pass@x.example"].join(":")).error, "webhook-url-userinfo");
		assert.equal(validateWebhookUrl("https://user@x.example").error, "webhook-url-userinfo");
		assert.equal(validateWebhookUrl("ftp://x.example/a").error, "webhook-url-scheme");
		assert.equal(validateWebhookUrl("not a url").error, "webhook-url-invalid");
		assert.equal(validateWebhookUrl("").error, "webhook-url-invalid");
		assert.equal(validateWebhookUrl(undefined).error, "webhook-url-invalid");
		assert.equal(validateWebhookUrl(`https://x.example/${"a".repeat(2048)}`).error, "webhook-url-invalid");
		assert.ok(validateWebhookUrl(`https://x.example/${"a".repeat(2048 - 19)}`).url);
	});
});

describe("validateWebhookUrl normal form and edge cases", () => {
	it("returns the parsed href and refuses empty user info", () => {
		assert.equal(validateWebhookUrl("HTTPS://Hooks.Example.COM/a b").url, "https://hooks.example.com/a%20b");
		assert.equal(validateWebhookUrl("https://:@x.example/").error, "webhook-url-userinfo");
		assert.equal(validateWebhookUrl("https://@x.example/").error, "webhook-url-userinfo");
		assert.ok(validateWebhookUrl("https://x.example/a@b?c=@").url);
	});

	const refused = [
		"https://[::ffff:127.0.0.1]/a",
		"https://[::ffff:7f00:1]/a",
		"https://2130706433/a",
		"https://0x7f.1/a",
		"https://0177.0.0.1/a",
		"https://127.1/a",
		"https://localhost/a",
		"https://127.0.0.1./a",
		"http://127.0.0.1:8080/a",
		"HTTP://[::1]:80/a",
	];
	for (const text of refused) {
		it(`checks ${text} as loopback`, async () => {
			answer(["127.0.0.1"]);
			const checked = validateWebhookUrl(text);
			assert.ok(checked.url);
			await assert.rejects(checkWebhookTarget(checked.url), { code: "EBLOCKED" });
		});
	}

	it("allows a LAN http address with a port, mapped or not, and normalises IDN names", async () => {
		answer(["192.168.1.5"]);
		for (const text of ["http://192.168.1.5:8080/a", "http://[::ffff:192.168.1.5]:81/a", "HTTP://nas.lan./a"]) {
			const checked = validateWebhookUrl(text);
			assert.equal(checked.privateOnly, true);
			assert.equal(await checkWebhookTarget(checked.url), undefined);
		}
		answer(["93.184.216.34"]);
		const idn = validateWebhookUrl("https://bücher.example/a");
		assert.equal(idn.url, "https://xn--bcher-kva.example/a");
		assert.equal(await checkWebhookTarget(idn.url), undefined);
	});
});

describe("urlHint", () => {
	it("keeps scheme, host, port and 40 characters of the path, never query or fragment", () => {
		const hint = urlHint(`https://hooks.example.com:8443/a/very/long/path/${"b".repeat(60)}?token=abc#x`);
		assert.ok(hint.startsWith("https://hooks.example.com:8443/a/very/long/path/bbbb"));
		assert.equal(hint.length, "https://hooks.example.com:8443".length + 40);
		assert.ok(!hint.includes("token"));
		assert.ok(!hint.includes("#"));
		assert.ok(!hint.includes("?"));
	});

	it("never cuts inside a percent escape", () => {
		for (const pad of [37, 38, 39]) {
			const hint = urlHint(`https://x.example/${"a".repeat(pad)}%2Fz`);
			assert.ok(!PARTIAL.test(hint), hint);
		}
		assert.equal(urlHint(`https://x.example/${"a".repeat(37)}%2Fz`), `https://x.example/${"a".repeat(37)}`);
	});

	it("keeps a short URL whole", () => {
		assert.equal(urlHint("http://192.168.1.5/x?a=1"), "http://192.168.1.5/x");
	});
});

describe("checkWebhookTarget", () => {
	it("refuses a name that resolves to loopback or a blocked address, any scheme", async () => {
		answer(["127.0.0.1"]);
		await assert.rejects(checkWebhookTarget("https://hook.example.com/a"), { code: "EBLOCKED" });
		answer(["8.8.8.8", "169.254.169.254"]);
		await assert.rejects(checkWebhookTarget("https://hook.example.com/a"), { code: "EBLOCKED" });
		await assert.rejects(checkWebhookTarget("https://127.0.0.1/a"), { code: "EBLOCKED" });
		await assert.rejects(checkWebhookTarget("https://[::1]/a"), { code: "EBLOCKED" });
	});

	it("allows https to a public address and a name", async () => {
		answer(["93.184.216.34"]);
		assert.equal(await checkWebhookTarget("https://hook.example.com/a"), undefined);
		assert.equal(await checkWebhookTarget("https://93.184.216.34/a"), undefined);
	});

	it("allows http only when every address is private LAN", async () => {
		answer(["192.168.1.5"]);
		assert.equal(await checkWebhookTarget("http://nas.lan/a"), undefined);
		assert.equal(await checkWebhookTarget("http://192.168.1.5/a"), undefined);
		answer(["192.168.1.5", "93.184.216.34"]);
		await assert.rejects(checkWebhookTarget("http://nas.lan/a"), { code: "EBLOCKED" });
		await assert.rejects(checkWebhookTarget("http://93.184.216.34/a"), { code: "EBLOCKED" });
		await assert.rejects(checkWebhookTarget("http://127.0.0.1/a"), { code: "EBLOCKED" });
	});

	it("marks a resolver outage as temporary, apart from a name that does not exist", async () => {
		for (const code of ["EAI_AGAIN", "ETIMEOUT", "ESERVFAIL"]) {
			answer(Object.assign(new Error(code), { code }));
			await assert.rejects(checkWebhookTarget("https://hook.example/a"), {
				code: "webhook-host-lookup-failed",
				temporary: true,
			});
		}
		answer(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
		await assert.rejects(checkWebhookTarget("https://hook.example/a"), (err) => err.temporary === undefined);
	});

	it("refuses an unresolved name", async () => {
		answer(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
		await assert.rejects(checkWebhookTarget("https://nope.example/a"), { code: "webhook-host-unresolved" });
		answer([]);
		await assert.rejects(checkWebhookTarget("http://nope.example/a"), { code: "webhook-host-unresolved" });
	});
});
