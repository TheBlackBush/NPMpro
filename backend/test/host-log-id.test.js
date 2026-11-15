import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

const ENVS_SH = new URL("../../rootfs/usr/local/bin/envs.sh", import.meta.url);
const SERVER_OPEN = /\bserver \{/u;
const REWRITE_DIRECTIVES = ["return ", "rewrite ", "if ("];
const TEMPLATE_VERSION_25 = /^TV="25"$/mu;

let api;
// filled once the API is up; a const holder so the tests built in loops read no reassigned binding
const loaded = {};

before(async () => {
	api = await startApi();
	loaded.nginx = (await import("../internal/nginx.js")).default;
});
after(() => api?.stop());

const PROXY_ROW = {
	id: 7,
	domain_names: ["log-id.example.com"],
	forward_scheme: "http",
	forward_host: "10.0.0.1",
	forward_port: 8080,
	npmpro_auth_request: "none",
	npmpro_access_list_type: "public",
	locations: [],
};
const REDIRECTION_ROW = {
	id: 7,
	domain_names: ["redir.example.com"],
	forward_http_code: 301,
	forward_scheme: "https",
	forward_domain_name: "example.org",
};
const DEAD_ROW = { id: 7, domain_names: ["gone.example.com"], npmpro_page: "global" };
const STREAM_ROW = { id: 7, incoming_port: 5000, forwarding_host: "10.0.0.2", forwarding_port: 5000 };

// each server block of a config: its text up to the end of the config
const serversOf = (text) => text.split(SERVER_OPEN).slice(1);

// what is wrong with the log id in these servers: none, missing, or after a rewrite-phase directive
const setProblems = (servers, line, label) => {
	if (servers.length === 0) {
		return [`no server in ${label}`];
	}
	const problems = [];
	for (const server of servers) {
		const set = server.indexOf(line);
		if (set === -1) {
			problems.push(`missing in ${label}`);
			continue;
		}
		for (const later of REWRITE_DIRECTIVES) {
			const at = server.indexOf(later);
			if (at !== -1 && at < set) {
				problems.push(`${later} before the log id in ${label}`);
			}
		}
	}
	return problems;
};

const CASES = [
	["proxy_host", PROXY_ROW, "set $npmpro_host_id proxy-7;", 1],
	["redirection_host", REDIRECTION_ROW, "set $npmpro_host_id redirection-7;", 1],
	["dead_host", DEAD_ROW, "set $npmpro_host_id dead-7;", 1],
	["stream", { ...STREAM_ROW, tcp_forwarding: true, udp_forwarding: true }, "set $npmpro_stream_id stream-7;", 2],
];
for (const [type, row, line, count] of CASES) {
	it(`${type} sets its log id in every server before any rewrite directive`, async () => {
		const text = await loaded.nginx.renderConfig(type, row, { env: {}, fetchMissingOcsp: false });
		const servers = serversOf(text);
		assert.equal(servers.length, count);
		assert.deepEqual(setProblems(servers, line, type), []);
	});
}

for (const value of ["444", "congratulations", "404", "html"]) {
	it(`the default site (${value}) sets the log id default in both servers`, async () => {
		const text = await loaded.nginx.renderConfig("default", { id: "default-site", value, meta: {} });
		const servers = serversOf(text);
		assert.equal(servers.length, 2);
		assert.deepEqual(setProblems(servers, "set $npmpro_host_id default;", `default ${value}`), []);
	});
}

it("bumps the template version, so existing installs rewrite their host configs", () => {
	assert.match(readFileSync(ENVS_SH, "utf8"), TEMPLATE_VERSION_25);
});
