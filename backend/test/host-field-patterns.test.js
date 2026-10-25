import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

// These fields are rendered unquoted into nginx directives, so they must not hold characters that end or open a token
const schema = (file) => JSON.parse(readFileSync(new URL(`../schema/${file}`, import.meta.url), "utf8"));
const pattern = (value) => new RegExp(value.pattern, "u");

const forwardHost = pattern(schema("components/proxy-host-object.json").properties.forward_host);
const forwardingHost = pattern(schema("components/stream-object.json").properties.forwarding_host);
const forwardDomain = pattern(schema("components/redirection-host-object.json").properties.forward_domain_name);
const address = pattern(schema("common.json").properties.address);

const NGINX_SYNTAX = [";", "{", "}", '"', "'", "\\", "#", " ", "\n"];

it("forward and redirect targets accept hosts and paths", () => {
	for (const value of ["10.0.0.1", "app", "[fd00::1]", "app/api/v1?x=1&y=2", "/var/www/site/", "h/$request_uri"]) {
		assert.equal(forwardHost.test(value), true, value);
	}
	for (const value of ["10.0.0.1", "db.internal", "[fd00::1]", "cu_upstream"]) {
		assert.equal(forwardingHost.test(value), true, value);
	}
	for (const value of ["example.com", "example.com:8443/path?x=1"]) {
		assert.equal(forwardDomain.test(value), true, value);
	}
});

it("forward and redirect targets refuse nginx syntax characters", () => {
	for (const char of NGINX_SYNTAX) {
		assert.equal(forwardHost.test(`app/a${char}b`), false, `forward path ${JSON.stringify(char)}`);
		assert.equal(forwardHost.test(`a${char}b`), false, `forward host ${JSON.stringify(char)}`);
		assert.equal(forwardingHost.test(`a${char}b`), false, `stream ${JSON.stringify(char)}`);
		assert.equal(forwardDomain.test(`a${char}b`), false, `redirect ${JSON.stringify(char)}`);
	}
});

it("access list addresses are IPs, CIDRs, all or unix:", () => {
	for (const value of ["", "192.168.0.11", "192.168.0.0/24", "fd00::/8", "all", "ALL", "unix:"]) {
		assert.equal(address.test(value), true, value);
	}
	for (const value of ["1.2.3.4;", "all;deny", "host.example.com", "1.2.3.4 5", "unix:/x"]) {
		assert.equal(address.test(value), false, value);
	}
});
