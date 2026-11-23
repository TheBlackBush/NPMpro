import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.NPMPRO_TEST_ROOT = "/nonexistent-ddns-public-ip-test";
process.env.NPMPRO_TEST_OUTBOUND = "mock";
const { createPublicIp, isPublicAddress, DEFAULT_IPV4_SERVICES, DEFAULT_IPV6_SERVICES } = await import(
	"../lib/ddns/public-ip.js"
);
const { providerFetch } = await import("../lib/ddns/provider-fetch.js");

const A = "81.2.69.160";
const B = "81.2.69.161";
const V6 = "2a00:1450:4001:80b::200e";
const URLS = ["https://one.example/", "https://two.example/", "https://three.example/"];

// answers: url -> body (string) or Error
const make = (answers, lists = { ipv4: URLS, ipv6: URLS }) => {
	const calls = [];
	const fetchText = (url, family) => {
		calls.push([url, family]);
		const answer = answers[url];
		return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
	};
	return { calls, ip: createPublicIp({ fetchText, services: () => lists }) };
};

describe("isPublicAddress", () => {
	it("accepts public addresses and one trailing line break", () => {
		assert.equal(isPublicAddress(A, 4), true);
		assert.equal(isPublicAddress(`${A}\n`, 4), true);
		assert.equal(isPublicAddress(`${A}\r\n`, 4), true);
		assert.equal(isPublicAddress(V6, 6), true);
		assert.equal(isPublicAddress(`${V6}\n`, 6), true);
	});

	it("refuses non-public IPv4 ranges", () => {
		for (const a of [
			"0.0.0.0",
			"10.0.0.1",
			"100.64.1.1",
			"127.0.0.1",
			"169.254.1.1",
			"172.16.5.5",
			"192.0.0.1",
			"192.0.2.1",
			"192.168.1.1",
			"198.18.0.1",
			"198.51.100.7",
			"203.0.113.9",
			"224.0.0.1",
			"240.0.0.1",
			"255.255.255.255",
		]) {
			assert.equal(isPublicAddress(a, 4), false, a);
		}
	});

	it("refuses non-public IPv6 ranges", () => {
		for (const a of [
			"::",
			"::1",
			"fd00::1",
			"fc00::1",
			"fe80::1",
			"ff02::1",
			"2001:db8::1",
			"2001:0:1::1",
			"2002::1",
			"::ffff:81.2.69.160",
		]) {
			assert.equal(isPublicAddress(a, 6), false, a);
		}
	});

	it("refuses what is not a single address", () => {
		assert.equal(isPublicAddress("<html>81.2.69.160</html>", 4), false);
		assert.equal(isPublicAddress(`${A}\n${B}`, 4), false);
		assert.equal(isPublicAddress(`${A}\n\n`, 4), false);
		assert.equal(isPublicAddress(` ${A}`, 4), false);
		assert.equal(isPublicAddress("", 4), false);
		assert.equal(isPublicAddress(null, 4), false);
		assert.equal(isPublicAddress("a".repeat(46), 6), false);
		assert.equal(isPublicAddress("2a00:1450::1%eth0", 6), false);
	});

	it("refuses an address of the other family", () => {
		assert.equal(isPublicAddress(A, 6), false);
		assert.equal(isPublicAddress(V6, 4), false);
	});
});

describe("defaults", () => {
	it("lists the amended services", () => {
		assert.deepEqual(DEFAULT_IPV4_SERVICES, [
			"https://api.ipify.org",
			"https://ipv4.icanhazip.com",
			"https://v4.ident.me",
		]);
		assert.deepEqual(DEFAULT_IPV6_SERVICES, [
			"https://api6.ipify.org",
			"https://ipv6.icanhazip.com",
			"https://v6.ident.me",
		]);
	});
});

describe("detect", () => {
	it("starts empty", () => {
		const { ip } = make({});
		assert.equal(ip.state(4).address, null);
		assert.equal(ip.state(6).checked_on, null);
	});

	it("takes a first address once the next service confirms it, trimming the line break", async () => {
		const { ip, calls } = make({ [URLS[0]]: `${A}\n`, [URLS[1]]: A });
		const state = await ip.detect(4);
		assert.equal(state.address, A);
		assert.equal(state.service, URLS[0]);
		assert.equal(state.error, null);
		assert.ok(state.checked_on);
		assert.deepEqual(calls, [
			[URLS[0], 4],
			[URLS[1], 4],
		]);
		assert.equal(ip.state(4), state);
	});

	it("works for IPv6 with the family pinned", async () => {
		const { ip, calls } = make({ [URLS[0]]: V6, [URLS[1]]: `${V6.toUpperCase()}\n` });
		const state = await ip.detect(6);
		assert.equal(state.address, V6);
		assert.deepEqual(
			calls.map((c) => c[1]),
			[6, 6],
		);
	});

	it("accepts an answer equal to the known address at once and goes round robin", async () => {
		const answers = { [URLS[0]]: A, [URLS[1]]: A, [URLS[2]]: A };
		const { ip, calls } = make(answers);
		await ip.detect(4);
		calls.length = 0;
		await ip.detect(4);
		await ip.detect(4);
		await ip.detect(4);
		assert.deepEqual(
			calls.map((c) => c[0]),
			[URLS[1], URLS[2], URLS[0]],
		);
		assert.equal(ip.state(4).address, A);
		assert.equal(ip.state(4).service, URLS[0]);
	});

	it("keeps the old address when the confirming service disagrees", async () => {
		const answers = { [URLS[0]]: A, [URLS[1]]: A, [URLS[2]]: B };
		const { ip } = make(answers);
		await ip.detect(4);
		answers[URLS[1]] = B;
		answers[URLS[2]] = A;
		const state = await ip.detect(4);
		assert.equal(state.address, A);
		assert.equal(state.error_i18n, "error.ddns-ip-disagree");
	});

	it("keeps the old address when the confirming service fails", async () => {
		const answers = { [URLS[0]]: A, [URLS[1]]: A, [URLS[2]]: B };
		const { ip } = make(answers);
		await ip.detect(4);
		answers[URLS[1]] = B;
		answers[URLS[2]] = new Error("down");
		const state = await ip.detect(4);
		assert.equal(state.address, A);
		assert.equal(state.error_i18n, "error.ddns-ip-unconfirmed");
	});

	it("does not take a first address a second service does not confirm", async () => {
		const { ip } = make({ [URLS[0]]: A, [URLS[1]]: B });
		const state = await ip.detect(4);
		assert.equal(state.address, null);
		assert.equal(state.error_i18n, "error.ddns-ip-disagree");
	});

	it("does not confirm with a single service", async () => {
		const { ip } = make({ [URLS[0]]: A }, { ipv4: [URLS[0]], ipv6: [] });
		const state = await ip.detect(4);
		assert.equal(state.address, null);
		assert.equal(state.error_i18n, "error.ddns-ip-unconfirmed");
	});

	it("moves on from a failed or refused service within one call", async () => {
		const { ip, calls } = make({
			[URLS[0]]: new Error("boom"),
			[URLS[1]]: "<html>nope</html>",
			[URLS[2]]: A,
		});
		const state = await ip.detect(4);
		assert.equal(calls[0][0], URLS[0]);
		assert.equal(calls[1][0], URLS[1]);
		assert.equal(calls[2][0], URLS[2]);
		assert.equal(state.address, null);
		assert.equal(state.error_i18n, "error.ddns-ip-unconfirmed");
	});

	it("refuses private answers from every service and keeps the old address", async () => {
		const answers = { [URLS[0]]: A, [URLS[1]]: A, [URLS[2]]: A };
		const { ip } = make(answers);
		await ip.detect(4);
		for (const url of URLS) answers[url] = "10.0.0.1";
		const state = await ip.detect(4);
		assert.equal(state.address, A);
		assert.equal(state.error_i18n, "error.ddns-ip-failed");
	});

	it("fails when every service fails, null address at first", async () => {
		const { ip } = make({ [URLS[0]]: new Error("a"), [URLS[1]]: new Error("b"), [URLS[2]]: new Error("c") });
		const state = await ip.detect(4);
		assert.equal(state.address, null);
		assert.equal(state.error_i18n, "error.ddns-ip-failed");
		assert.equal(state.error, "c");
	});

	it("fails with no service set", async () => {
		const { ip } = make({}, { ipv4: [], ipv6: [] });
		assert.equal((await ip.detect(6)).error_i18n, "error.ddns-ip-failed");
	});

	it("logs a failed service", async () => {
		const logs = [];
		const ip = createPublicIp({
			fetchText: () => Promise.reject(new Error("down")),
			services: () => ({ ipv4: [URLS[0]], ipv6: [] }),
			log: (m) => logs.push(m),
		});
		await ip.detect(4);
		assert.equal(logs.length, 1);
	});

	it("shows the guard's message for a service at a blocked address", async () => {
		const ip = createPublicIp({
			fetchText: (url, family) => providerFetch(url, { family }).then((r) => r.text),
			services: () => ({ ipv4: ["https://127.0.0.1/"], ipv6: [] }),
		});
		const state = await ip.detect(4);
		assert.equal(state.error_i18n, "error.ddns-ip-failed");
		assert.equal(state.error, "127.0.0.1 resolves to an address outbound requests may not reach");
	});
});
