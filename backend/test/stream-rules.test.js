import assert from "node:assert/strict";
import { it } from "node:test";
import { cleanStreamData } from "../lib/stream-rules.js";

it("sends PROXY protocol v2 instead of v1 over UDP", () => {
	const out = cleanStreamData({ tcp_forwarding: true, udp_forwarding: true, npmpro_proxy_protocol_forwarding: 1 });
	assert.equal(out.npmpro_proxy_protocol_forwarding, 2);
	assert.equal(out.npmpro_proxy_tls, false);
	assert.equal(out.certificate_id, 0);
});

it("keeps v1 over TCP only and v2 or off over UDP", () => {
	assert.equal(
		cleanStreamData({ tcp_forwarding: true, npmpro_proxy_protocol_forwarding: 1 }).npmpro_proxy_protocol_forwarding,
		1,
	);
	for (const value of [0, 2]) {
		const out = cleanStreamData({ udp_forwarding: true, npmpro_proxy_protocol_forwarding: value });
		assert.equal(out.npmpro_proxy_protocol_forwarding, value);
	}
});

it("uses the saved row for the fields an update leaves out", () => {
	const out = cleanStreamData(
		{ udp_forwarding: true },
		{ tcp_forwarding: false, npmpro_proxy_protocol_forwarding: 1 },
	);
	assert.equal(out.npmpro_proxy_protocol_forwarding, 2);
});

it("needs the DNS challenge for a new certificate", () => {
	assert.throws(() => cleanStreamData({ tcp_forwarding: true, certificate_id: "new" }), {
		name: "ValidationError",
		message_i18n: "error.stream.new-certificate-dns",
	});
	assert.equal(
		cleanStreamData({ tcp_forwarding: true, certificate_id: "new", npmpro_dns_challenge: true }).certificate_id,
		"new",
	);
	// UDP has no certificate, so a new one is dropped instead of refused
	assert.equal(cleanStreamData({ udp_forwarding: true, certificate_id: "new" }).certificate_id, 0);
});

it("needs TCP or UDP", () => {
	assert.throws(() => cleanStreamData({ tcp_forwarding: false, udp_forwarding: false }), { name: "ValidationError" });
});
