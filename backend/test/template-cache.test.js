import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { Liquid } from "liquidjs";
import utils from "../lib/utils.js";

const DIR = path.join(import.meta.dirname, "../templates");
const ENV = {
	DISABLE_HTTP: "false",
	DISABLE_IPV6: "false",
	DISABLE_H3_QUIC: "false",
	IPV4_BINDING: "0.0.0.0",
	IPV6_BINDING: "[::]",
	HTTP_PORT: "80",
	HTTPS_PORT: "443",
	ACME_OCSP_STAPLING: "false",
	CUSTOM_OCSP_STAPLING: "false",
};
const PLAIN = {
	id: 1,
	env: ENV,
	domain_names: ["one.example.com"],
	server_names: ['"one.example.com"'],
	forward_scheme: "http",
	forward_host: "10.0.0.1",
	forward_port: 80,
	forward_upstream_name: "upstream_1",
	forward_domain_name: "target.example.org",
	forward_http_code: 301,
	incoming_port: "9000",
	forwarding_host: "10.0.0.1",
	forwarding_port: "22",
	tcp_forwarding: true,
	value: "congratulations",
	meta: {},
	ip_ranges: ["10.0.0.0/8"],
	path: "/one",
	upstreams: "",
	locations: "",
};
const TLS = {
	...PLAIN,
	id: 2,
	domain_names: ["two.example.com"],
	server_names: ['"two.example.com"'],
	forward_host: "10.0.0.2",
	forward_upstream_name: "upstream_2",
	certificate_id: 7,
	certificate: { id: 7, provider: "letsencrypt" },
	ssl_forced: true,
	hsts_enabled: true,
	npmpro_http3_support: true,
	value: "html",
	path: "/two",
};

// the engine as every render built it before the cache
const cold = () => {
	const engine = new Liquid({ root: `${DIR}/` });
	engine.registerFilter("nginxAccessRule", (v) => (v.directive && v.address ? `${v.directive} ${v.address};` : ""));
	return engine;
};

it("renders every template byte for byte as an engine with no cache does, again and again", async () => {
	const names = (await readdir(DIR)).filter((name) => name.endsWith(".conf"));
	assert.ok(names.length >= 9, names.join());
	for (const name of names) {
		const text = await readFile(path.join(DIR, name), "utf8");
		for (const scope of [PLAIN, TLS, PLAIN]) {
			const expected = await cold().parseAndRender(text, scope);
			assert.equal(await utils.renderTemplate(name, scope), expected, name);
			assert.equal(await utils.renderTemplate(name, scope), expected, name);
		}
	}
});

it("keeps no value of the host before, also in the partial", async () => {
	for (const name of ["proxy_host.conf", "redirection_host.conf", "dead_host.conf"]) {
		const first = await utils.renderTemplate(name, PLAIN);
		const second = await utils.renderTemplate(name, TLS);
		const third = await utils.renderTemplate(name, PLAIN);
		assert.equal(third, first, name);
		assert.match(first, /one\.example\.com/u);
		assert.doesNotMatch(first, /two\.example\.com|npm-7\/fullchain/u);
		assert.match(second, /two\.example\.com/u);
		assert.match(second, /npm-7\/fullchain\.pem/u);
		assert.doesNotMatch(second, /one\.example\.com/u);
	}
});

it("renders hosts at the same time without mixing them", async () => {
	const sequential = [
		await utils.renderTemplate("proxy_host.conf", PLAIN),
		await utils.renderTemplate("proxy_host.conf", TLS),
	];
	const answers = await Promise.all(
		Array.from({ length: 40 }, (_, n) => utils.renderTemplate("proxy_host.conf", n % 2 ? TLS : PLAIN)),
	);
	for (const [n, answer] of answers.entries()) assert.equal(answer, sequential[n % 2]);
});

it("has one engine, with the filter, and it still renders a text", async () => {
	assert.equal(utils.getRenderEngine(), utils.getRenderEngine());
	const out = await utils.getRenderEngine().parseAndRender("{{ rule | nginxAccessRule }}", {
		rule: { directive: "allow", address: "10.0.0.1" },
	});
	assert.equal(out, "allow 10.0.0.1;");
});
