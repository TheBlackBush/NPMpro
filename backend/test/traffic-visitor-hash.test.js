import assert from "node:assert/strict";
import { it } from "node:test";
import { createVisitorHasher, loadVisitorKey, normaliseIp } from "../lib/traffic/visitor-hash.js";

const key = Buffer.alloc(32, 7);
const box = { encrypt: (s) => `enc:${s}`, decrypt: (s) => s.slice(4) };

it("hashes deterministically to 32 lowercase hex characters", () => {
	const hash = createVisitorHasher(key);
	assert.match(hash("203.0.113.7"), /^[0-9a-f]{32}$/u);
	assert.equal(hash("203.0.113.7"), hash("203.0.113.7"));
	assert.notEqual(hash("203.0.113.7"), hash("203.0.113.8"));
});

it("differs between keys", () => {
	assert.notEqual(createVisitorHasher(key)("203.0.113.7"), createVisitorHasher(Buffer.alloc(32, 8))("203.0.113.7"));
});

it("normalises IPv4-mapped IPv6", () => {
	const hash = createVisitorHasher(key);
	assert.equal(hash("::ffff:203.0.113.7"), hash("203.0.113.7"));
	assert.equal(hash("::FFFF:203.0.113.7"), hash("203.0.113.7"));
});

it("counts IPv6 per /64 network", () => {
	const hash = createVisitorHasher(key);
	assert.equal(normaliseIp("2001:db8:1:2:aaaa::1"), "2001:db8:1:2::/64");
	assert.equal(hash("2001:db8:1:2::1"), hash("2001:db8:1:2:ffff:ffff:ffff:ffff"));
	assert.notEqual(hash("2001:db8:1:2::1"), hash("2001:db8:1:3::1"));
	assert.equal(hash("2001:DB8:0001:0002:0:0:0:9"), hash("2001:db8:1:2::9"));
	assert.equal(normaliseIp("2001:db8::1"), "2001:db8:0:0::/64");
	assert.equal(normaliseIp("::1"), "0:0:0:0::/64");
	assert.equal(normaliseIp("fe80::1%eth0"), "fe80:0:0:0::/64");
	assert.equal(hash("fe80::1%eth0"), hash("fe80::2"));
	assert.equal(normaliseIp("64:ff9b::192.0.2.1"), "64:ff9b:0:0::/64");
	assert.equal(normaliseIp("::ffff:cb00:7107"), "203.0.113.7");
	assert.equal(normaliseIp("0:0:0:0:0:ffff:203.0.113.7"), "203.0.113.7");
	assert.equal(hash("::ffff:1.2.3.4"), hash("1.2.3.4"));
	assert.equal(normaliseIp("not an ip"), "not an ip");
});

it("does not leak the IP", () => {
	const out = createVisitorHasher(key)("203.0.113.7");
	assert.ok(!out.includes("203.0.113.7"));
	assert.ok(!out.includes(Buffer.from("203.0.113.7").toString("hex")));
});

const store = (initial) => {
	let meta = initial;
	return {
		readMeta: async () => meta,
		writeMeta: async (m) => {
			meta = m;
		},
		get: () => meta,
	};
};

it("creates and stores an encrypted key, then reuses it", async () => {
	const s = store(undefined);
	const first = await loadVisitorKey({ ...s, box });
	assert.equal(first.created, true);
	assert.equal(first.replaced, false, "nothing was stored before");
	assert.equal(first.key.length, 32);
	assert.ok(s.get().visitor_key.startsWith("enc:"));
	assert.ok(!s.get().visitor_key.includes(first.key.toString("hex")));
	const second = await loadVisitorKey({ ...s, box });
	assert.equal(second.created, false);
	assert.equal(second.replaced, false);
	assert.deepEqual(second.key, first.key);
});

it("keeps other meta fields when creating", async () => {
	const s = store({ other: 1 });
	await loadVisitorKey({ ...s, box });
	assert.equal(s.get().other, 1);
});

it("creates a new key when decryption throws", async () => {
	const s = store({ visitor_key: "garbage" });
	const bad = {
		encrypt: box.encrypt,
		decrypt: () => {
			throw new Error("nope");
		},
	};
	const r = await loadVisitorKey({ ...s, box: bad });
	assert.equal(r.created, true);
	assert.equal(r.replaced, true);
	assert.notEqual(s.get().visitor_key, "garbage");
});

it("creates a new key when the decrypted length is wrong", async () => {
	const s = store({ visitor_key: `enc:${Buffer.alloc(16).toString("base64")}` });
	const r = await loadVisitorKey({ ...s, box });
	assert.equal(r.created, true);
	assert.equal(r.replaced, true);
	assert.equal(r.key.length, 32);
});
