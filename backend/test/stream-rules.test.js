import assert from "node:assert/strict";
import { it } from "node:test";
import { cleanStreamData, rangeSize, reservedPortClash, reservedPorts } from "../lib/stream-rules.js";

it("sends PROXY protocol v2 instead of v1 over UDP, and keeps v1 over TCP only", () => {
	{
		const out = cleanStreamData({
			tcp_forwarding: true,
			udp_forwarding: true,
			npmpro_proxy_protocol_forwarding: 1,
		});
		assert.equal(out.npmpro_proxy_protocol_forwarding, 2);
		assert.equal(out.npmpro_proxy_tls, false);
		assert.equal(out.certificate_id, 0);
	}
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

it("reserves the ports NPMpro listens on, with their real protocols", () => {
	assert.deepEqual(reservedPorts({}), [
		{ port: 80, protocol: "tcp", setting: "HTTP_PORT" },
		{ port: 443, protocol: "tcp", setting: "HTTPS_PORT" },
		{ port: 443, protocol: "udp", setting: "HTTPS_PORT" },
		{ port: 81, protocol: "tcp", setting: "NPM_PORT" },
	]);
	assert.deepEqual(
		reservedPorts({
			HTTP_PORT: "8080",
			HTTPS_PORT: "8443",
			NPM_PORT: "9081",
			DISABLE_HTTP: "true",
			DISABLE_H3_QUIC: "true",
		}),
		[
			{ port: 8443, protocol: "tcp", setting: "HTTPS_PORT" },
			{ port: 9081, protocol: "tcp", setting: "NPM_PORT" },
		],
	);
});

it("finds a reserved port inside a stream's port or range, only for the protocols it uses", () => {
	const tcp = (incoming_port) => ({ incoming_port, tcp_forwarding: true, udp_forwarding: false });
	const udp = (incoming_port) => ({ incoming_port, tcp_forwarding: false, udp_forwarding: true });
	assert.deepEqual(reservedPortClash(tcp("443"), {}), { port: 443, protocol: "tcp", setting: "HTTPS_PORT" });
	assert.deepEqual(reservedPortClash(tcp("75-85"), {}), { port: 80, protocol: "tcp", setting: "HTTP_PORT" });
	assert.deepEqual(reservedPortClash(udp("443"), {}), { port: 443, protocol: "udp", setting: "HTTPS_PORT" });
	assert.equal(reservedPortClash(udp("443"), { DISABLE_H3_QUIC: "true" }), null);
	assert.equal(reservedPortClash(udp("80"), {}), null);
	assert.equal(reservedPortClash(udp("81"), {}), null);
	assert.equal(reservedPortClash(tcp("80"), { DISABLE_HTTP: "true" }), null);
	assert.equal(reservedPortClash(tcp("8443"), {}), null);
	assert.equal(reservedPortClash(tcp("not a port"), {}), null);
});

it("counts the ports of a range and refuses one wider than 1000 ports on a changed port", () => {
	assert.equal(rangeSize({ start: 8000, end: 8000 }), 1);
	assert.equal(rangeSize({ start: 8000, end: 8999 }), 1000);
	assert.doesNotThrow(() => cleanStreamData({ incoming_port: "8000-8999", tcp_forwarding: true }));
	assert.throws(() => cleanStreamData({ incoming_port: "8000-9000", tcp_forwarding: true }), {
		status: 400,
		message_i18n: "error.stream-port-range-too-wide",
	});
	assert.throws(() => cleanStreamData({ incoming_port: "1-65535", tcp_forwarding: true }), {
		message_i18n: "error.stream-port-range-too-wide",
	});
	// a stored range keeps saving
	assert.doesNotThrow(() =>
		cleanStreamData(
			{ incoming_port: "1-65535", npmpro_description: "x" },
			{ incoming_port: "1-65535", tcp_forwarding: true },
		),
	);
});
