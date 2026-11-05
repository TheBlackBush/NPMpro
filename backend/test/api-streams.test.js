import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { addCertificate, checkFields, countRows, created, hostTests, listDir } from "./support/hosts.js";

// /nginx/streams (schema/paths/nginx/streams). The shared tests of every host type are in support/hosts.js.

const ctx = {};
let counter = 0;
const body = (overrides = {}) => {
	counter += 1;
	return {
		incoming_port: String(9100 + counter),
		forwarding_host: `10.0.2.${counter}`,
		forwarding_port: "22",
		tcp_forwarding: true,
		...overrides,
	};
};
const URL = "/nginx/streams";
const confOf = (id) => `data/nginx/stream/${id}.conf`;
const dotted = (text) => text.replaceAll(".", "\\.");
const serverBlocks = (config) => config.split(/^ {4}server \{$/mu).slice(1);

before(async () => {
	ctx.api = await startApi();
	ctx.admin = await ctx.api.admin();
});
after(() => ctx.api?.stop());

hostTests(ctx, {
	label: "stream",
	path: URL,
	permission: "streams",
	dir: "data/nginx/stream",
	table: "stream",
	make: body,
	check: checkFields,
	search: (stream) => stream.incoming_port,
	written: (stream) =>
		new RegExp(
			`server ${dotted(stream.forwarding_host)}:22 resolve;[\\s\\S]*listen \\S*:${stream.incoming_port} reuseport deferred[\\s\\S]*proxy_pass stream_upstream_\\d+;`,
			"u",
		),
	edit: () => ({ forwarding_port: "2222" }),
	edited: (stream) => new RegExp(`server ${dotted(stream.forwarding_host)}:2222 resolve;`, "u"),
	invalid: [
		["a port that is no number", { incoming_port: "abc" }],
		["a port range with three parts", { incoming_port: "1-2-3" }],
		["a space in the host", { forwarding_host: "a b" }],
		["a semicolon in the host", { forwarding_host: "a;b" }],
		["a forwarding port that is no number", { forwarding_port: "abc" }],
		["neither TCP nor UDP", { tcp_forwarding: false, udp_forwarding: false }],
		["an unknown property", { bogus: true }],
	],
	adminOnly: { npmpro_advanced_config: "proxy_timeout 1s;" },
});

it("answers the post without the port or the host with the missing property", async () => {
	const { incoming_port, ...noPort } = body();
	assert.match((await ctx.admin.post(URL, noPort)).body.error.message, /incoming_port/u);
	const { forwarding_host, ...noHost } = body();
	assert.match((await ctx.admin.post(URL, noHost)).body.error.message, /forwarding_host/u);
});

it("writes a TCP listener only for TCP, a UDP listener only for UDP, and both for both", async () => {
	const tcp = await created(await ctx.admin.post(URL, body({ tcp_forwarding: true, udp_forwarding: false })), "tcp");
	const udp = await created(await ctx.admin.post(URL, body({ tcp_forwarding: false, udp_forwarding: true })), "udp");
	const both = await created(await ctx.admin.post(URL, body({ tcp_forwarding: true, udp_forwarding: true })), "both");
	const tcpBlocks = serverBlocks(await ctx.api.read(confOf(tcp.id)));
	assert.equal(tcpBlocks.length, 1);
	assert.match(tcpBlocks[0], new RegExp(`listen \\S*:${tcp.incoming_port} reuseport deferred so_keepalive=on;`, "u"));
	assert.doesNotMatch(tcpBlocks[0], / udp /u);
	assert.match(tcpBlocks[0], /include \/data\/custom_nginx\/server_stream_tcp\.conf;/u);
	const udpBlocks = serverBlocks(await ctx.api.read(confOf(udp.id)));
	assert.equal(udpBlocks.length, 1);
	assert.match(udpBlocks[0], new RegExp(`listen \\S*:${udp.incoming_port} udp reuseport;`, "u"));
	assert.doesNotMatch(udpBlocks[0], /deferred/u);
	assert.match(udpBlocks[0], /include \/data\/custom_nginx\/server_stream_udp\.conf;/u);
	const bothBlocks = serverBlocks(await ctx.api.read(confOf(both.id)));
	assert.equal(bothBlocks.length, 2);
	assert.match(bothBlocks[0], /deferred/u);
	assert.match(bothBlocks[1], / udp reuseport;/u);
	// one upstream is shared by both listeners
	assert.equal((await ctx.api.read(confOf(both.id))).match(/^upstream stream_upstream_/gmu)?.length ?? 0, 0);
	assert.equal((await ctx.api.read(confOf(both.id))).match(/ upstream stream_upstream_\d+ \{/gu).length, 1);
});

it("refuses a stream that neither forwards TCP nor UDP, also on edit, and keeps the stored one", async () => {
	const rows = await countRows(ctx.api, "stream");
	const none = await ctx.admin.post(URL, body({ tcp_forwarding: false }));
	assert.equal(none.status, 400);
	assert.equal(none.body.error.message, "TCP or UDP forwarding needs to be enabled");
	assert.equal(await countRows(ctx.api, "stream"), rows);
	const stream = await created(await ctx.admin.post(URL, body()), "create");
	const edit = await ctx.admin.put(`${URL}/${stream.id}`, { tcp_forwarding: false });
	assert.equal(edit.status, 400);
	assert.equal((await ctx.api.db("stream").where({ id: stream.id }).first()).tcp_forwarding, 1);
});

it("accepts a port range and writes it as the listen port", async () => {
	const stream = await created(await ctx.admin.post(URL, body({ incoming_port: "9300-9310" })), "create");
	assert.equal(stream.incoming_port, "9300-9310");
	assert.match(await ctx.api.read(confOf(stream.id)), /listen \S*:9300-9310 reuseport deferred/u);
});

it("keeps the port of a TCP and a UDP stream apart: one port may serve both protocols", async () => {
	const tcp = await created(await ctx.admin.post(URL, body({ incoming_port: "9400" })), "tcp");
	const udp = await ctx.admin.post(URL, body({ incoming_port: "9400", tcp_forwarding: false, udp_forwarding: true }));
	assert.equal(udp.status, 201, udp.text);
	assert.notEqual(udp.body.id, tcp.id);
});

it("refuses a second stream on the same port and protocol", async () => {
	const first = await created(await ctx.admin.post(URL, body({ incoming_port: "9500" })), "create");
	const second = await ctx.admin.post(URL, body({ incoming_port: "9500" }));
	const rows = await ctx.api.db("stream").where({ incoming_port: "9500" });
	assert.equal(second.status, 400, second.text);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].id, first.id);
});

it("refuses a port above 65535 or 0", async () => {
	const rows = await countRows(ctx.api, "stream");
	for (const incoming_port of ["99999", "70000", "0"]) {
		const answer = await ctx.admin.post(URL, body({ incoming_port }));
		assert.equal(answer.status, 400, incoming_port);
	}
	assert.equal(await countRows(ctx.api, "stream"), rows);
});

it("treats overlapping port ranges on one protocol as a duplicate", async () => {
	await created(await ctx.admin.post(URL, body({ incoming_port: "20000-20010" })), "range");
	for (const incoming_port of ["20005", "20010-20020", "19990-20000", "19000-21000"]) {
		const answer = await ctx.admin.post(URL, body({ incoming_port }));
		assert.equal(answer.status, 400, incoming_port);
	}
	const next = await ctx.admin.post(URL, body({ incoming_port: "20011-20020" }));
	assert.equal(next.status, 201, next.text);
	const udp = await ctx.admin.post(
		URL,
		body({ incoming_port: "20005", tcp_forwarding: false, udp_forwarding: true }),
	);
	assert.equal(udp.status, 201, udp.text);
});

it("refuses to move a stream onto a used port, and lets it keep its own", async () => {
	const first = await created(await ctx.admin.post(URL, body({ incoming_port: "20100" })), "first");
	const second = await created(await ctx.admin.post(URL, body({ incoming_port: "20101" })), "second");
	assert.equal((await ctx.admin.put(`${URL}/${second.id}`, { incoming_port: "20100" })).status, 400);
	assert.equal((await ctx.admin.put(`${URL}/${second.id}`, { udp_forwarding: true })).status, 200);
	assert.equal((await ctx.admin.put(`${URL}/${first.id}`, { incoming_port: "20100" })).status, 200);
	const udp = await created(
		await ctx.admin.post(URL, body({ incoming_port: "20100", tcp_forwarding: false, udp_forwarding: true })),
		"udp",
	);
	assert.equal((await ctx.admin.put(`${URL}/${udp.id}`, { tcp_forwarding: true })).status, 400);
});

it("lets a disabled stream share a port and refuses to enable it while the port is used", async () => {
	const first = await created(await ctx.admin.post(URL, body({ incoming_port: "20200" })), "first");
	const second = await created(await ctx.admin.post(URL, body({ incoming_port: "20201" })), "second");
	assert.equal((await ctx.admin.post(`${URL}/${second.id}/disable`)).status, 200);
	assert.equal((await ctx.admin.put(`${URL}/${second.id}`, { incoming_port: "20200" })).status, 200);
	assert.equal((await ctx.admin.post(`${URL}/${second.id}/enable`)).status, 400);
	assert.equal((await ctx.admin.post(`${URL}/${first.id}/disable`)).status, 200);
	assert.equal((await ctx.admin.post(`${URL}/${second.id}/enable`)).status, 200);
	assert.equal((await ctx.admin.post(`${URL}/${first.id}/enable`)).status, 400);
});

it("counts the streams of other users for the port check", async () => {
	const user = await ctx.api.limited({ visibility: "user", streams: "manage", certificates: "view" });
	await created(await ctx.admin.post(URL, body({ incoming_port: "20300" })), "admin");
	const answer = await user.post(URL, body({ incoming_port: "20300" }));
	assert.equal(answer.status, 400, answer.text);
});

it("lets a save that keeps the port, protocols and state work on a row that already duplicates another", async () => {
	const first = await created(await ctx.admin.post(URL, body({ incoming_port: "20400" })), "first");
	const second = await created(await ctx.admin.post(URL, body({ incoming_port: "20401" })), "second");
	await ctx.api.db("stream").where({ id: second.id }).update({ incoming_port: "20400" });
	const rename = await ctx.admin.put(`${URL}/${second.id}`, { npmpro_description: "repaired later" });
	assert.equal(rename.status, 200, rename.text);
	assert.equal((await ctx.admin.put(`${URL}/${second.id}`, { incoming_port: "20402" })).status, 200);
	assert.notEqual(first.id, second.id);
});

it("accepts the ports 1 and 65535 and refuses 65536, a reversed range and a range past 65535", async () => {
	for (const incoming_port of ["1", "65535"]) {
		const answer = await ctx.admin.post(URL, body({ incoming_port }));
		assert.equal(answer.status, 201, `${incoming_port}: ${answer.text}`);
		await ctx.admin.delete(`${URL}/${answer.body.id}`);
	}
	for (const incoming_port of ["65536", "9010-9000", "65530-65540", "0-10", "00000"]) {
		assert.equal((await ctx.admin.post(URL, body({ incoming_port }))).status, 400, incoming_port);
	}
});

it("lets a save that keeps an out of range port work on an older row", async () => {
	const stream = await created(await ctx.admin.post(URL, body({ incoming_port: "20500" })), "create");
	await ctx.api.db("stream").where({ id: stream.id }).update({ incoming_port: "70000" });
	assert.equal((await ctx.admin.put(`${URL}/${stream.id}`, { npmpro_description: "x" })).status, 200);
	assert.equal((await ctx.admin.put(`${URL}/${stream.id}`, { incoming_port: "70001" })).status, 400);
});

it("turns TLS, the certificate and PROXY protocol v1 off for UDP", async () => {
	const certificate = await addCertificate(ctx.api, { domain: "stream.example.com" });
	const tls = await created(
		await ctx.admin.post(
			URL,
			body({ certificate_id: certificate, npmpro_proxy_tls: true, npmpro_proxy_protocol_forwarding: 1 }),
		),
		"tls",
	);
	assert.equal(tls.certificate_id, certificate);
	assert.equal(tls.npmpro_proxy_tls, true);
	const config = await ctx.api.read(confOf(tls.id));
	assert.match(config, new RegExp(`listen \\S*:${tls.incoming_port} ssl reuseport deferred`, "u"));
	assert.match(config, new RegExp(`ssl_certificate /data/tls/custom/npm-${certificate}/fullchain\\.pem;`, "u"));
	assert.match(config, /proxy_protocol on;/u);
	assert.match(config, /proxy_ssl on;/u);
	const udp = await ctx.admin.put(`${URL}/${tls.id}`, { udp_forwarding: true });
	assert.equal(udp.status, 200, udp.text);
	assert.equal(udp.body.certificate_id, 0);
	assert.equal(udp.body.npmpro_proxy_tls, false);
	assert.equal(udp.body.npmpro_proxy_protocol_forwarding, 2);
	const after = await ctx.api.read(confOf(tls.id));
	assert.doesNotMatch(after, /ssl_certificate|proxy_ssl on;|proxy_protocol on;/u);
	assert.match(after, /proxy_protocol v2;/u);
});

it("refuses a new certificate for a stream without the DNS challenge", async () => {
	const rows = await countRows(ctx.api, "stream");
	const noNames = await ctx.admin.post(URL, body({ certificate_id: "new" }));
	assert.equal(noNames.status, 400);
	assert.match(noNames.body.error.message, /domain_names/u);
	const answer = await ctx.admin.post(
		URL,
		body({
			certificate_id: "new",
			domain_names: ["stream.example.com"],
			npmpro_dns_challenge: false,
			npmpro_dns_provider: "cloudflare",
			npmpro_dns_credential_id: 1,
		}),
	);
	assert.equal(answer.status, 400, answer.text);
	assert.match(answer.body.error.message, /npmpro_dns_challenge/u);
	assert.equal(await countRows(ctx.api, "stream"), rows);
});

it("forwards to the port of the connection with $server_port, and to a custom upstream by its name", async () => {
	const same = await created(await ctx.admin.post(URL, body({ forwarding_port: "$server_port" })), "create");
	const config = await ctx.api.read(confOf(same.id));
	assert.match(config, /proxy_pass 10\.0\.2\.\d+:\$server_port;/u);
	assert.doesNotMatch(config, /upstream stream_upstream_/u);
	const named = await created(
		await ctx.admin.post(URL, body({ forwarding_host: "cu_backend", forwarding_port: "" })),
		"create",
	);
	const custom = await ctx.api.read(confOf(named.id));
	assert.match(custom, /proxy_pass cu_backend;/u);
	assert.doesNotMatch(custom, /upstream stream_upstream_/u);
});

it("renders the advanced config of an administrator into the server block", async () => {
	const stream = await created(
		await ctx.admin.post(URL, body({ npmpro_advanced_config: "proxy_timeout 5s;" })),
		"create",
	);
	assert.match(
		await ctx.api.read(confOf(stream.id)),
		/proxy_pass stream_upstream_\d+;[\s\S]*proxy_timeout 5s;[\s\S]*include \/data\/custom_nginx\/server_stream\.conf;/u,
	);
});

it("finds a stream by its forwarding host, its forwarding port and its description", async () => {
	const stream = await created(
		await ctx.admin.post(
			URL,
			body({
				forwarding_host: "search.example.net",
				forwarding_port: "4711",
				npmpro_description: "Findable thing",
			}),
		),
		"create",
	);
	for (const query of ["search.example", "4711", "Findable"]) {
		const found = await ctx.admin.get(`${URL}?query=${encodeURIComponent(query)}`);
		assert.ok(
			found.body.some((entry) => entry.id === stream.id),
			query,
		);
	}
});
