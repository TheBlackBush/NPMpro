import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { addCertificate, countRows, created, fileExists, listDir, readConfig } from "./support/hosts.js";

// What the generated host configs contain (templates/proxy_host.conf, _common.conf, _upstream.conf,
// _proxy_host_custom_location.conf, redirection_host.conf, dead_host.conf, stream.conf) and which admin-only fields the
// host-config guard refuses. HTTP/2 is switched on for all hosts in the base nginx.conf (http2 on), so a host config
// has no http2 parameter. The reports at the end count hosts per type.

const ctx = {};
let counter = 0;
const body = (overrides = {}) => {
	counter += 1;
	return {
		domain_names: [`cfg${counter}.example.com`],
		forward_scheme: "http",
		forward_host: `10.0.3.${counter}`,
		forward_port: 8000 + counter,
		...overrides,
	};
};
const URL = "/nginx/proxy-hosts";
const confOf = (id) => `data/nginx/proxy_host/${id}.conf`;
const PASS_AUTH_CLEARED = /proxy_set_header Authorization "";/u;
const PHP_REQUEST_ID_DROPPED = /fastcgi_param HTTP_X_NPMPRO_REQUEST_ID "" if_not_empty;/u;
const AUTHORIZATION_EMPTY = /Authorization ""/u;
const AUTHELIA_CHECK = /auth_request \/internal\/authelia\/authz;/u;
const ANY_AUTH_REQUEST = /auth_request/u;
const BUILT_IN_ACME = /location \^~ \/\.well-known\/acme-challenge\/ \{/gu;
const CUSTOM_ACME_PROXY_PASS = /proxy_pass http:\/\/upstream_\d+_location_0;/u;
const UNPREFIXED_HELPER = /location \/(?:\.within\.website\/|oauth2\/|outpost\.goauthentik\.io) /u;
const ACME_ROOT = /root \/data\/public\/acme-challenge;/u;
const NO_PROVIDER_CHECK = /auth_request \/|authelia\/authz|goauthentik|\/tinyauth/u;

const count = (text, regex) => (text.match(regex) ?? []).length;
const read = (file) => readConfig(ctx.api, file);
const configOf = async (host) => read(confOf(host.id));
const make = async (overrides, who = ctx.admin) => created(await who.post(URL, body(overrides)), "create");
// the text of a location block, up to the line that closes it at the same indent
const block = (config, header) => {
	const start = config.indexOf(header);
	assert.ok(start >= 0, `no "${header}" in the config`);
	const rest = config.slice(start);
	return rest.slice(0, rest.search(/\n\s*location /u) > 0 ? rest.search(/\n\s*location /u) : rest.length);
};

before(async () => {
	ctx.api = await startApi({
		env: {
			IPV4_BINDING: "0.0.0.0",
			IPV6_BINDING: "[::]",
			HTTP_PORT: "80",
			HTTPS_PORT: "443",
			DISABLE_HTTP: "false",
			DISABLE_IPV6: "false",
			DISABLE_H3_QUIC: "false",
		},
	});
	ctx.admin = await ctx.api.admin();
});
after(() => ctx.api?.stop());

it("writes the plain HTTP listeners and the server name of a host without a certificate", async () => {
	const host = await make({ domain_names: ["plain.example.com", "www.plain.example.com"] });
	const config = await configOf(host);
	assert.match(config, /server_name "plain\.example\.com" "www\.plain\.example\.com";/u);
	assert.match(config, /listen unix:\/run\/nginx\.sock;/u);
	assert.match(config, /listen 0\.0\.0\.0:80;/u);
	assert.match(config, /listen \[::\]:80;/u);
	assert.doesNotMatch(config, /ssl_certificate|ssl;|quic;/u);
	assert.match(config, /more_clear_headers "Strict-Transport-Security";/u);
	assert.match(config, /location \^~ \/\.well-known\/acme-challenge\/ \{\s+root \/data\/public\/acme-challenge;/u);
	assert.match(config, /include \/data\/custom_nginx\/server_proxy\.conf;/u);
});

it("writes an upstream for http and https, and proxy_pass with the scheme", async () => {
	const http = await make({ forward_scheme: "http", forward_host: "app.internal", forward_port: 3000 });
	const https = await make({ forward_scheme: "https", forward_host: "secure.internal", forward_port: 8443 });
	const first = await configOf(http);
	assert.match(
		first,
		new RegExp(
			`upstream upstream_${http.id} \\{\\s+zone upstream_${http.id} 128k;\\s+server app\\.internal:3000 resolve;\\s+\\}`,
			"u",
		),
	);
	assert.match(first, new RegExp(`proxy_pass http://upstream_${http.id};`, "u"));
	assert.match(first, /include proxy-headers\.conf;/u);
	assert.match(await configOf(https), new RegExp(`proxy_pass https://upstream_${https.id};`, "u"));
	assert.match(await configOf(https), /server secure\.internal:8443 resolve;/u);
});

it("splits a path off the forward host into the proxy_pass path", async () => {
	const host = await make({ forward_host: "app.internal/base/", forward_port: 80 });
	const config = await configOf(host);
	assert.match(config, /server app\.internal:80 resolve;/u);
	assert.match(config, new RegExp(`proxy_pass http://upstream_${host.id}/base/;`, "u"));
});

it("uses grpc_pass for gRPC, and no upstream or proxy_pass for a path or empty scheme", async () => {
	const grpc = await make({ forward_scheme: "grpc", forward_host: "rpc.internal", forward_port: 50051 });
	const grpcs = await make({ forward_scheme: "grpcs", forward_host: "rpcs.internal", forward_port: 50052 });
	assert.match(await configOf(grpc), new RegExp(`grpc_pass grpc://upstream_${grpc.id};`, "u"));
	assert.match(await configOf(grpc), /include grpc-headers\.conf;/u);
	assert.match(await configOf(grpcs), new RegExp(`grpc_pass grpcs://upstream_${grpcs.id};`, "u"));
	const files = await make({ forward_scheme: "path", forward_host: "/var/www/site", forward_port: 0 });
	const config = await configOf(files);
	assert.match(config, /root \/var\/www\/site;/u);
	assert.doesNotMatch(config, /upstream upstream_|proxy_pass http/u);
	const folder = await make({ forward_scheme: "path", forward_host: "/var/www/folder/", forward_port: 0 });
	assert.match(await configOf(folder), /alias \/var\/www\/folder\/;/u);
	const php = await make({
		forward_scheme: "path",
		forward_host: "/var/www/php",
		forward_port: 83,
		npmpro_fancyindex: true,
	});
	const phpConfig = await configOf(php);
	assert.match(phpConfig, /fancyindex on;/u);
	assert.match(phpConfig, /fastcgi_pass unix:\/run\/php83\.sock;/u);
	assert.match(phpConfig, PHP_REQUEST_ID_DROPPED);
	const empty = await make({ forward_scheme: "empty", forward_host: "", forward_port: 0 });
	assert.doesNotMatch(await configOf(empty), /proxy_pass http|grpc_pass|upstream upstream_/u);
});

it("keeps the forward options only where the scheme uses them", async () => {
	const proxy = await make({
		npmpro_crowdsec_appsec: true,
		npmpro_proxy_request_buffering: true,
		npmpro_proxy_response_buffering: true,
	});
	assert.equal(proxy.npmpro_proxy_request_buffering, true);
	const config = await configOf(proxy);
	assert.match(config, /proxy_request_buffering off;/u);
	assert.match(config, /proxy_buffering off;/u);
	assert.match(config, /set \$crowdsec_disable_appsec 1;/u);
	// request buffering needs the AppSec switch, fancyindex needs the path scheme
	const plain = await make({ npmpro_proxy_request_buffering: true, npmpro_fancyindex: true });
	assert.equal(plain.npmpro_proxy_request_buffering, false);
	assert.equal(plain.npmpro_fancyindex, false);
	assert.doesNotMatch(await configOf(plain), /proxy_request_buffering/u);
	const grpc = await make({ forward_scheme: "grpc", npmpro_proxy_response_buffering: true });
	assert.equal(grpc.npmpro_proxy_response_buffering, false);
});

it("writes noindex, the X-Frame-Options choice and the upstream compression switch", async () => {
	const host = await make({
		npmpro_noindex: true,
		npmpro_x_frame_options: "DENY",
		npmpro_upstream_compression: true,
	});
	const config = await configOf(host);
	assert.match(config, /include noindex-nofollow\.conf;/u);
	assert.match(config, /more_set_headers "X-Frame-Options: DENY";/u);
	assert.doesNotMatch(config, /proxy_set_header Accept-Encoding ""/u);
	const none = await make({ npmpro_x_frame_options: "none" });
	assert.match(await configOf(none), /more_clear_headers "X-Frame-Options";/u);
	assert.match(await configOf(none), /proxy_set_header Accept-Encoding "";/u);
	const upstream = await make({ npmpro_x_frame_options: "upstream" });
	assert.doesNotMatch(await configOf(upstream), /X-Frame-Options/u);
	assert.equal((await ctx.admin.post(URL, body({ npmpro_x_frame_options: "ALLOW" }))).status, 400);
});

it("writes the certificate, the TLS listeners and the HTTP/3 listener, and no HSTS without a forced redirect", async () => {
	const certificate = await addCertificate(ctx.api, { domain: "tls.example.com" });
	const host = await make({ domain_names: ["tls.example.com"], certificate_id: certificate });
	const config = await configOf(host);
	assert.match(config, /listen 0\.0\.0\.0:443 ssl;/u);
	assert.match(config, /listen \[::\]:443 ssl;/u);
	assert.match(config, /listen 0\.0\.0\.0:443 quic;/u);
	assert.match(config, new RegExp(`ssl_certificate /data/tls/custom/npm-${certificate}/fullchain\\.pem;`, "u"));
	assert.match(config, new RegExp(`ssl_certificate_key /data/tls/custom/npm-${certificate}/privkey\\.pem;`, "u"));
	assert.match(config, /# Custom TLS/u);
	// no forced redirect: HTTP stays usable, HSTS is cleared, and HTTP/3 is not announced
	assert.doesNotMatch(config, /return 301 https:/u);
	assert.match(config, /more_clear_headers "Strict-Transport-Security";/u);
	assert.doesNotMatch(config, /Alt-Svc/u);
	assert.doesNotMatch(config, /http2/u);
});

it("announces HTTP/3 only when the host asks for it", async () => {
	const certificate = await addCertificate(ctx.api, { domain: "h3.example.com" });
	const on = await make({
		domain_names: ["h3.example.com"],
		certificate_id: certificate,
		npmpro_http3_support: true,
	});
	assert.equal(on.npmpro_http3_support, true);
	assert.match(await configOf(on), /more_set_headers 'Alt-Svc: h3=":\$alt_svc_port"; ma=86400';/u);
	const off = await ctx.admin.put(`${URL}/${on.id}`, { npmpro_http3_support: false });
	assert.equal(off.status, 200, off.text);
	assert.doesNotMatch(await configOf(on), /Alt-Svc/u);
	// without a certificate the switch is dropped
	const bare = await make({ npmpro_http3_support: true });
	assert.equal(bare.npmpro_http3_support, false);
});

const FORWARDED_PROTO_REDIRECT = /if \(\$npmpro_forwarded_proto = "http"\) \{\s+return 301 https:/u;
const OLD_PROTO_CHECKS = /\$http_x_forwarded_proto|if \(\$scheme = "http"\)/u;

it("forces HTTPS and HSTS by the forwarded proto of a trusted proxy", async () => {
	const certificate = await addCertificate(ctx.api, { domain: "proto.example.com" });
	const host = await make({
		domain_names: ["proto.example.com"],
		certificate_id: certificate,
		ssl_forced: true,
		hsts_enabled: true,
	});
	const config = await configOf(host);
	assert.match(config, FORWARDED_PROTO_REDIRECT);
	assert.doesNotMatch(config, OLD_PROTO_CHECKS);
});
it("redirects HTTP to HTTPS when SSL is forced, and writes HSTS with or without subdomains", async () => {
	const certificate = await addCertificate(ctx.api, { domain: "hsts.example.com" });
	const forced = await make({ domain_names: ["hsts.example.com"], certificate_id: certificate, ssl_forced: true });
	const forcedConfig = await configOf(forced);
	assert.match(
		forcedConfig,
		/if \(\$npmpro_forwarded_proto = "http"\) \{\s+return 301 https:\/\/\$host\$is_request_port\$request_port\$request_uri;/u,
	);
	assert.match(forcedConfig, /more_clear_headers "Strict-Transport-Security";/u);
	assert.doesNotMatch(forcedConfig, /more_set_headers "Strict-Transport-Security/u);
	const hsts = await ctx.admin.put(`${URL}/${forced.id}`, { hsts_enabled: true });
	assert.equal(hsts.status, 200, hsts.text);
	assert.match(await configOf(forced), /more_set_headers "Strict-Transport-Security: \$hsts_header";/u);
	assert.doesNotMatch(await configOf(forced), /more_clear_headers "Strict-Transport-Security"/u);
	const subdomains = await ctx.admin.put(`${URL}/${forced.id}`, { hsts_subdomains: true });
	assert.equal(subdomains.body.hsts_subdomains, true);
	assert.match(
		await configOf(forced),
		/more_set_headers "Strict-Transport-Security: \$hsts_includeSubDomains_header";/u,
	);
	// turning the redirect off turns HSTS and its subdomain switch off with it
	const off = await ctx.admin.put(`${URL}/${forced.id}`, { ssl_forced: false });
	assert.equal(off.body.ssl_forced, false);
	assert.equal(off.body.hsts_enabled, false);
	assert.equal(off.body.hsts_subdomains, false);
	assert.doesNotMatch(await configOf(forced), /return 301 https:|more_set_headers "Strict-Transport/u);
});

it("drops SSL, HSTS and HTTP/3 when a host has no certificate", async () => {
	const host = await make({
		ssl_forced: true,
		hsts_enabled: true,
		hsts_subdomains: true,
		npmpro_http3_support: true,
	});
	assert.equal(host.ssl_forced, false);
	assert.equal(host.hsts_enabled, false);
	assert.equal(host.hsts_subdomains, false);
	assert.equal(host.npmpro_http3_support, false);
	assert.doesNotMatch(await configOf(host), /ssl|quic|return 301 https/u);
});

it("requires a client certificate when an mTLS certificate is set, and forces SSL with it", async () => {
	const certificate = await addCertificate(ctx.api, { domain: "mtls.example.com" });
	const ca = await addCertificate(ctx.api, { provider: "mtls", domain: "ca.example.com" });
	const strict = await make({
		domain_names: ["mtls.example.com"],
		certificate_id: certificate,
		npmpro_mtls_certificate_id: ca,
	});
	assert.equal(strict.ssl_forced, true);
	const config = await configOf(strict);
	assert.match(config, /ssl_verify_client on;/u);
	assert.match(config, new RegExp(`ssl_client_certificate /data/tls/mtls/npm-${ca}\\.pem;`, "u"));
	const optional = await ctx.admin.put(`${URL}/${strict.id}`, {
		npmpro_mtls_verify_client_optional: true,
		ssl_forced: false,
	});
	assert.equal(optional.status, 200, optional.text);
	assert.match(await configOf(strict), /ssl_verify_client optional;/u);
	// an mTLS certificate is no server certificate, and a server certificate is no CA
	const swapped = await ctx.admin.post(URL, body({ certificate_id: ca }));
	assert.equal(swapped.body.error.message_i18n, "error.certificate.is-mtls");
	const notCa = await ctx.admin.post(
		URL,
		body({ certificate_id: certificate, npmpro_mtls_certificate_id: certificate }),
	);
	assert.equal(notCa.body.error.message_i18n, "error.certificate.not-mtls");
});

it("includes the basic auth and allow rules of an access list, and writes its password file", async () => {
	const list = await ctx.admin.post("/nginx/access-lists", {
		name: "Staff",
		satisfy_any: true,
		items: [{ username: "bob", password: "bobs-password-1" }],
		clients: [
			{ address: "10.1.0.0/16", directive: "allow" },
			{ address: "all", directive: "deny" },
		],
	});
	assert.equal(list.status, 201, list.text);
	const host = await make({ npmpro_access_list_type: "custom", npmpro_access_list_ids: [list.body.id] });
	const config = await configOf(host);
	assert.match(
		config,
		new RegExp(
			`auth_basic\\s+"basic access authentication required";\\s+auth_basic_user_file\\s+/data/access/${list.body.id};`,
			"u",
		),
	);
	const main = block(config, "location / {");
	assert.match(main, /auth_basic_user_file\s+\/data\/access\/\d+;/u);
	assert.match(main, /allow 10\.1\.0\.0\/16;\s+deny all;/u);
	assert.match(main, /satisfy any;/u);
	assert.match(main, /proxy_set_header Authorization "";/u);
	assert.match(main, /grpc_set_header Authorization "";/u);
	const passwords = await read(`data/access/${list.body.id}`);
	assert.match(passwords, /^bob:/mu);
	assert.doesNotMatch(passwords, /bobs-password-1/u);
	// public again: the include is gone
	const publicHost = await ctx.admin.put(`${URL}/${host.id}`, {
		npmpro_access_list_type: "public",
		npmpro_access_list_ids: [],
	});
	assert.equal(publicHost.status, 200, publicHost.text);
	assert.doesNotMatch(await configOf(host), /auth_basic\s+"|allow 10\.1/u);
});

it("passes the Authorization header on when the access list has pass_auth", async () => {
	const list = await ctx.admin.post("/nginx/access-lists", {
		name: "Passing",
		pass_auth: true,
		items: [{ username: "carol", password: "carols-password-1" }],
	});
	assert.equal(list.status, 201, list.text);
	const host = await make({ npmpro_access_list_type: "custom", npmpro_access_list_ids: [list.body.id] });
	const main = block(await configOf(host), "location / {");
	assert.match(main, /auth_basic_user_file/u);
	assert.doesNotMatch(main, /Authorization ""/u);
});

it("passes the Authorization header on only when every list with users has pass_auth", async () => {
	const lists = [];
	for (const [name, pass_auth] of [
		["Pass-1", true],
		["NoPass-2", false],
	]) {
		const list = await ctx.admin.post("/nginx/access-lists", {
			name,
			pass_auth,
			items: [{ username: name.toLowerCase(), password: `${name}-password-1` }],
		});
		assert.equal(list.status, 201, list.text);
		lists.push(list.body.id);
	}
	const mixed = await make({ npmpro_access_list_type: "custom", npmpro_access_list_ids: lists });
	assert.match(block(await configOf(mixed), "location / {"), PASS_AUTH_CLEARED);
	// a list without users (rules only) does not count
	const rulesOnly = await ctx.admin.post("/nginx/access-lists", {
		name: "Rules-3",
		pass_auth: false,
		clients: [{ address: "10.1.0.0/16", directive: "allow" }],
	});
	const passing = await make({
		npmpro_access_list_type: "custom",
		npmpro_access_list_ids: [lists[0], rulesOnly.body.id],
	});
	assert.doesNotMatch(block(await configOf(passing), "location / {"), AUTHORIZATION_EMPTY);
});

it("merges two access lists into one file for the host and removes the file with the host", async () => {
	const lists = [];
	for (const name of ["First", "Second"]) {
		const list = await ctx.admin.post("/nginx/access-lists", {
			name,
			items: [{ username: name.toLowerCase(), password: `${name}-password-1` }],
		});
		lists.push(list.body.id);
	}
	const host = await make({ npmpro_access_list_type: "custom", npmpro_access_list_ids: lists });
	const config = await configOf(host);
	const file = config.match(/auth_basic_user_file\s+(\S+);/u)[1];
	assert.match(file, /^\/data\/access\//u);
	const merged = await read(file.slice(1));
	assert.match(merged, /^first:/mu);
	assert.match(merged, /^second:/mu);
	assert.equal((await ctx.admin.delete(`${URL}/${host.id}`)).status, 200);
	assert.equal(await fileExists(ctx.api, file.slice(1)), false);
	// the lists themselves stay
	assert.equal(await fileExists(ctx.api, `data/access/${lists[0]}`), true);
});

it("refuses an access list that does not exist, and a custom type without a list", async () => {
	const rows = await countRows(ctx.api, "proxy_host");
	const missing = await ctx.admin.post(
		URL,
		body({ npmpro_access_list_type: "custom", npmpro_access_list_ids: [9999] }),
	);
	assert.equal(missing.status, 400, missing.text);
	assert.match(missing.body.error.message, /access list/iu);
	const none = await ctx.admin.post(URL, body({ npmpro_access_list_type: "custom" }));
	assert.equal(none.status, 400);
	assert.equal(await countRows(ctx.api, "proxy_host"), rows);
});

it("writes custom locations with their own upstream, scheme, access list and flags", async () => {
	const list = await ctx.admin.post("/nginx/access-lists", {
		name: "Admin area",
		items: [{ username: "root", password: "root-password-1" }],
	});
	const host = await make({
		locations: [
			{
				path: "/admin",
				forward_scheme: "https",
				forward_host: "admin.internal",
				forward_port: 9443,
				npmpro_access_list_type: "custom",
				npmpro_access_list_ids: [list.body.id],
				npmpro_noindex: true,
			},
			{
				path: "/rpc",
				location_type: "= ",
				forward_scheme: "grpc",
				forward_host: "rpc.internal",
				forward_port: 50051,
			},
			{
				path: "/files/",
				location_type: "^~ ",
				forward_scheme: "path",
				forward_host: "/var/www/files/",
				forward_port: 0,
			},
			{ path: "/off", forward_host: "off.internal", npmpro_enabled: false },
		],
	});
	const config = await configOf(host);
	const admin = block(config, 'location "/admin" {');
	assert.match(admin, /auth_basic_user_file/u);
	assert.match(admin, new RegExp(`proxy_pass https://upstream_${host.id}_location_0;`, "u"));
	assert.match(admin, /include noindex-nofollow\.conf;/u);
	assert.match(
		config,
		new RegExp(`upstream upstream_${host.id}_location_0 \\{[^}]*server admin\\.internal:9443 resolve;`, "u"),
	);
	assert.match(
		block(config, 'location = "/rpc" {'),
		new RegExp(`grpc_pass grpc://upstream_${host.id}_location_1;`, "u"),
	);
	assert.match(block(config, 'location ^~ "/files/" {'), /alias \/var\/www\/files\/;/u);
	// the main location has no basic auth, a disabled location is left out
	assert.doesNotMatch(block(config, "location / {"), /auth_basic_user_file/u);
	assert.doesNotMatch(config, /\/off|off\.internal/u);
});

const ACME_PATH = "/.well-known/acme-challenge/";

it("a custom location with exactly /.well-known/acme-challenge/ replaces the built-in ACME location, plain prefix and ^~", async () => {
	for (const [location_type, header] of [
		["", `location "${ACME_PATH}" {`],
		["^~ ", `location ^~ "${ACME_PATH}" {`],
	]) {
		const host = await make({
			locations: [{ path: ACME_PATH, location_type, forward_host: "10.7.7.7", forward_port: 8080 }],
		});
		const config = await configOf(host);
		assert.equal(count(config, BUILT_IN_ACME), 0, `type "${location_type}"`);
		assert.doesNotMatch(config, ACME_ROOT);
		assert.equal(config.split(header).length - 1, 1, header);
		assert.match(block(config, header), CUSTOM_ACME_PROXY_PASS);
	}
});

it("keeps the built-in ACME location for other types, the path without a slash, a deeper path and a disabled location", async () => {
	const cases = [
		{ path: ACME_PATH, location_type: "= " },
		{ path: "^/\\.well-known/acme-challenge/", location_type: "~ " },
		{ path: ACME_PATH, location_type: "~* " },
		{ path: "/.well-known/acme-challenge", location_type: "" },
		{ path: "/.well-known/acme-challenge/sub/", location_type: "" },
		{ path: ACME_PATH, location_type: "", npmpro_enabled: false },
	];
	for (const entry of cases) {
		const host = await make({ locations: [{ ...entry, forward_host: "10.7.7.8", forward_port: 8080 }] });
		assert.equal(count(await configOf(host), BUILT_IN_ACME), 1, JSON.stringify(entry));
	}
});

it("a hand-quoted stored path counts as the override", async () => {
	const host = await make({
		locations: [{ path: `"${ACME_PATH}"`, location_type: "", forward_host: "10.7.7.9", forward_port: 8080 }],
	});
	assert.equal(count(await configOf(host), BUILT_IN_ACME), 0);
});

it("redirection and 404 hosts keep the built-in ACME location with ^~", async () => {
	const redirection = await created(
		await ctx.admin.post("/nginx/redirection-hosts", {
			domain_names: ["acme-redir.example.com"],
			forward_domain_name: "target.example.org",
			forward_scheme: "https",
			forward_http_code: 301,
		}),
		"create",
	);
	const dead = await created(
		await ctx.admin.post("/nginx/dead-hosts", { domain_names: ["acme-dead.example.com"] }),
		"create",
	);
	assert.equal(count(await read(`data/nginx/redirection_host/${redirection.id}.conf`), BUILT_IN_ACME), 1);
	assert.equal(count(await read(`data/nginx/dead_host/${dead.id}.conf`), BUILT_IN_ACME), 1);
});

it("puts ^~ on the built-in forward authentication prefix locations", async () => {
	const wanted = {
		anubis: "location ^~ /.within.website/ {",
		oauth2proxy: "location ^~ /oauth2/ {",
		authentik: "location ^~ /outpost.goauthentik.io {",
	};
	for (const [provider, header] of Object.entries(wanted)) {
		const host = await make({
			npmpro_auth_request: provider,
			npmpro_auth_request_upstream: "http://127.0.0.1:9000",
		});
		const config = await configOf(host);
		assert.ok(config.includes(header), header);
		assert.equal(config.includes("location = /oauth2/auth {"), provider === "oauth2proxy");
		assert.doesNotMatch(config, UNPREFIXED_HELPER);
	}
});

it("quotes names and paths so they cannot leave their directive", async () => {
	const regex = '~^a"b;c{2}$';
	const host = await make({
		domain_names: [regex, "*.wild.example.com"],
		locations: [{ path: "/a;b{c}", forward_host: "10.9.9.9" }],
	});
	const config = await configOf(host);
	assert.match(config, /server_name "~\^a\\"b;c\{2\}\$" "\*\.wild\.example\.com";/u);
	assert.match(config, /location "\/a;b\{c\}" \{/u);
});

it("writes the advanced config of an administrator into the host and into a location", async () => {
	const host = await make({
		advanced_config: "add_header X-Host-Advanced one;",
		npmpro_location_config: "add_header X-Main-Location two;",
		locations: [{ path: "/loc", forward_host: "10.9.9.8", advanced_config: "add_header X-Loc-Advanced three;" }],
	});
	assert.equal(host.advanced_config, "add_header X-Host-Advanced one;");
	const config = await configOf(host);
	assert.match(config, /add_header X-Host-Advanced one;[\s\S]*include \/data\/custom_nginx\/server_proxy\.conf;/u);
	assert.match(block(config, "location / {"), /add_header X-Main-Location two;/u);
	assert.match(block(config, 'location "/loc" {'), /add_header X-Loc-Advanced three;/u);
	assert.doesNotMatch(block(config, 'location "/loc" {'), /X-Main-Location/u);
});

const KEEP_SCHEME_REDIRECT = /return 301 \$npmpro_forwarded_proto:\/\/t\.example\.org\$request_uri;/u;
const CONNECTION_SCHEME_REDIRECT = /\$scheme:\/\//u;
const HTTPS_REDIRECT = /return 301 https:\/\/t\.example\.org\$request_uri;/u;
const HTTP_REDIRECT = /return 301 http:\/\/t\.example\.org\$request_uri;/u;

it("a redirection host that keeps the scheme follows a trusted proxy's X-Forwarded-Proto, a fixed scheme stays", async () => {
	const configFor = async (name, scheme) => {
		const host = await created(
			await ctx.admin.post("/nginx/redirection-hosts", {
				domain_names: [`${name}.example.com`],
				forward_domain_name: "t.example.org",
				forward_scheme: scheme,
				forward_http_code: 301,
				preserve_path: true,
			}),
			name,
		);
		assert.equal(host.forward_scheme, scheme);
		return read(`data/nginx/redirection_host/${host.id}.conf`);
	};
	const keep = await configFor("keep-scheme", "$scheme");
	assert.match(keep, KEEP_SCHEME_REDIRECT);
	assert.doesNotMatch(keep, CONNECTION_SCHEME_REDIRECT);
	assert.match(await configFor("fixed-https", "https"), HTTPS_REDIRECT);
	assert.match(await configFor("fixed-http", "http"), HTTP_REDIRECT);
});

it("gives a redirection host and a 404 host the certificate, HSTS and the HTTP/3 header of the shared block", async () => {
	const certificate = await addCertificate(ctx.api, { domain: "shared-tls.example.com" });
	const redirect = await created(
		await ctx.admin.post("/nginx/redirection-hosts", {
			domain_names: ["shared-tls.example.com"],
			forward_domain_name: "t.example.org",
			certificate_id: certificate,
			ssl_forced: true,
			hsts_enabled: true,
			npmpro_http3_support: true,
		}),
		"redirect",
	);
	const config = await read(`data/nginx/redirection_host/${redirect.id}.conf`);
	assert.match(config, /listen 0\.0\.0\.0:443 ssl;/u);
	assert.match(config, new RegExp(`ssl_certificate /data/tls/custom/npm-${certificate}/fullchain\\.pem;`, "u"));
	assert.match(config, /Strict-Transport-Security: \$hsts_header/u);
	assert.match(config, /Alt-Svc/u);
	const dead = await created(
		await ctx.admin.post("/nginx/dead-hosts", {
			domain_names: ["shared-tls2.example.com"],
			certificate_id: certificate,
			ssl_forced: true,
		}),
		"dead",
	);
	assert.match(await read(`data/nginx/dead_host/${dead.id}.conf`), /return 301 https:/u);
});

it("writes a stream with TLS, the PROXY protocol and the certificate the host uses", async () => {
	const certificate = await addCertificate(ctx.api, { domain: "stream.example.com" });
	const stream = await created(
		await ctx.admin.post("/nginx/streams", {
			incoming_port: "9600",
			forwarding_host: "10.0.4.1",
			forwarding_port: "443",
			tcp_forwarding: true,
			certificate_id: certificate,
			npmpro_proxy_protocol_forwarding: 2,
		}),
		"stream",
	);
	const config = await read(`data/nginx/stream/${stream.id}.conf`);
	assert.match(config, /# 9600 TCP: true UDP: false/u);
	assert.match(config, /listen 0\.0\.0\.0:9600 ssl reuseport deferred so_keepalive=on;/u);
	assert.match(config, /listen \[::\]:9600 ssl reuseport deferred so_keepalive=on;/u);
	assert.match(config, /proxy_protocol v2;/u);
	assert.match(config, new RegExp(`ssl_certificate /data/tls/custom/npm-${certificate}/fullchain\\.pem;`, "u"));
});

it("does not let a user with manage set a custom location's advanced config or a path outside /var/www", async () => {
	const user = await ctx.api.limited({
		visibility: "user",
		proxy_hosts: "manage",
		access_lists: "view",
		certificates: "view",
	});
	const rows = await countRows(ctx.api, "proxy_host");
	const files = await listDir(ctx.api, "data/nginx/proxy_host");
	const advanced = await ctx.api.limited({
		visibility: "user",
		proxy_hosts: "manage",
		access_lists: "view",
		certificates: "view",
	});
	for (const attempt of [
		[
			advanced,
			{ locations: [{ path: "/a", forward_host: "10.1.1.1", advanced_config: "return 200;" }] },
			403,
			"error.advanced-config-admin-only",
		],
		[user, { npmpro_location_config: "return 200;" }, 403, "error.advanced-config-admin-only"],
		[user, { advanced_config: "return 200;" }, 403, "error.advanced-config-admin-only"],
		[user, { forward_scheme: "path", forward_host: "/etc", forward_port: 0 }, 400, "error.path-scheme-webroot"],
		[
			user,
			{ forward_scheme: "path", forward_host: "/var/www/../etc", forward_port: 0 },
			400,
			"error.path-scheme-webroot",
		],
		[
			user,
			{ forward_scheme: "path", forward_host: "/var/www2", forward_port: 0 },
			400,
			"error.path-scheme-webroot",
		],
		[user, { forward_scheme: "path", forward_host: "relative", forward_port: 0 }, 400, "error.path-scheme-webroot"],
		[
			user,
			{ locations: [{ path: "/p", forward_scheme: "path", forward_host: "/etc/", forward_port: 0 }] },
			400,
			"error.path-scheme-webroot",
		],
		[
			user,
			{ locations: [{ path: "/p", forward_scheme: "path", forward_host: "/var/www/a/", forward_port: 0 }] },
			400,
			"error.path-scheme-alias-prefix",
		],
	]) {
		const [who, extra, status, code] = attempt;
		const answer = await who.post(URL, body(extra));
		assert.equal(answer.status, status, JSON.stringify(extra));
		assert.equal(answer.body.error.message_i18n, code, JSON.stringify(extra));
	}
	assert.equal(await countRows(ctx.api, "proxy_host"), rows);
	assert.deepEqual(await listDir(ctx.api, "data/nginx/proxy_host"), files);
	const allowed = await user.post(
		URL,
		body({ forward_scheme: "path", forward_host: "/var/www/mine", forward_port: 0 }),
	);
	assert.equal(allowed.status, 201, allowed.text);
	assert.match(await configOf(allowed.body), /root \/var\/www\/mine;/u);
});

it("refuses an administrator's folder location without the trailing slash, and keeps a stored one", async () => {
	const folder = { path: "/p", forward_scheme: "path", forward_host: "/var/www/a/", forward_port: 0 };
	const refused = await ctx.admin.post(URL, body({ locations: [folder] }));
	assert.equal(refused.status, 400, refused.text);
	assert.equal(refused.body.error.message_i18n, "error.path-scheme-alias-prefix");
	const host = await make({ locations: [{ ...folder, path: "/p/" }] });
	// a location stored before the rule (written to the table directly) keeps saving
	await ctx.api.db("npmpro_location").where({ proxy_host_id: host.id }).update({ path: "/p" });
	const kept = await ctx.admin.put(`${URL}/${host.id}`, { forward_port: 8099, locations: [folder] });
	assert.equal(kept.status, 200, kept.text);
});

it("lets a user with manage keep what an administrator set, and refuses a change of it", async () => {
	const user = await ctx.api.limited({
		visibility: "user",
		proxy_hosts: "manage",
		access_lists: "view",
		certificates: "view",
	});
	const host = await make({
		advanced_config: "add_header X-Keep yes;",
		locations: [{ path: "/k", forward_host: "10.5.5.5", advanced_config: "add_header X-Loc-Keep yes;" }],
	});
	assert.equal((await ctx.admin.put(`/users/${user.user.id}/permissions`, { visibility: "all" })).status, 200);
	// the same value and an omitted value keep the stored config, a different one is refused
	const same = await user.put(`${URL}/${host.id}`, { advanced_config: "add_header X-Keep yes;", forward_port: 8123 });
	assert.equal(same.status, 200, same.text);
	assert.equal(same.body.forward_port, 8123);
	const kept = await user.put(`${URL}/${host.id}`, {
		forward_port: 8124,
		locations: [{ path: "/k", forward_host: "10.5.5.5" }],
	});
	assert.equal(kept.status, 200, kept.text);
	assert.equal(kept.body.advanced_config, "add_header X-Keep yes;");
	assert.equal(kept.body.locations[0].advanced_config, "add_header X-Loc-Keep yes;");
	assert.match(await configOf(host), /add_header X-Loc-Keep yes;/u);
	const changed = await user.put(`${URL}/${host.id}`, { advanced_config: "add_header X-Other yes;" });
	assert.equal(changed.status, 403);
	const locationChanged = await user.put(`${URL}/${host.id}`, {
		locations: [{ path: "/k", forward_host: "10.5.5.5", advanced_config: "return 200;" }],
	});
	assert.equal(locationChanged.status, 403);
	assert.equal(
		(await ctx.api.db("proxy_host").where({ id: host.id }).first()).advanced_config,
		"add_header X-Keep yes;",
	);
});

it("counts the hosts per type in the report, only the own ones for visibility user, and the hosts with an error", async () => {
	const api = ctx.api;
	const own = await api.limited({
		visibility: "user",
		proxy_hosts: "manage",
		redirection_hosts: "manage",
		dead_hosts: "manage",
		streams: "manage",
		access_lists: "view",
		certificates: "view",
	});
	const total = async (table) => countRows(api, table);
	const before = (await ctx.admin.get("/reports/hosts")).body;
	assert.equal(before.proxy, await total("proxy_host"));
	assert.equal(before.redirection, await total("redirection_host"));
	assert.equal(before.dead, await total("dead_host"));
	assert.equal(before.stream, await total("stream"));
	assert.equal(before.access_list, await total("access_list"));
	assert.equal(before.certificate, await total("certificate"));
	assert.deepEqual(before.errors, { proxy: 0, redirection: 0, dead: 0, stream: 0 });
	assert.deepEqual((await own.get("/reports/hosts")).body.proxy, 0);

	await created(await own.post(URL, body()), "proxy");
	await created(
		await own.post("/nginx/redirection-hosts", {
			domain_names: ["rep-r.example.com"],
			forward_domain_name: "t.example.org",
		}),
		"redirection",
	);
	await created(await own.post("/nginx/dead-hosts", { domain_names: ["rep-d.example.com"] }), "dead");
	await created(
		await own.post("/nginx/streams", { incoming_port: "9700", forwarding_host: "10.0.5.1", tcp_forwarding: true }),
		"stream",
	);
	const mine = (await own.get("/reports/hosts")).body;
	assert.deepEqual([mine.proxy, mine.redirection, mine.dead, mine.stream], [1, 1, 1, 1]);
	const all = (await ctx.admin.get("/reports/hosts")).body;
	assert.deepEqual(
		[all.proxy, all.redirection, all.dead, all.stream],
		[before.proxy + 1, before.redirection + 1, before.dead + 1, before.stream + 1],
	);

	// a host whose reload nginx refused counts as an error, a disabled one does not
	api.outside.control.failNext = "nginx: [emerg] bad";
	const broken = await make();
	assert.equal(broken.npmpro_nginx_online, false);
	assert.equal((await ctx.admin.get("/reports/hosts")).body.errors.proxy, 1);
	assert.equal((await ctx.admin.post(`${URL}/${broken.id}/disable`)).status, 200);
	assert.equal((await ctx.admin.get("/reports/hosts")).body.errors.proxy, 0);
	assert.equal((await api.client().get("/reports/hosts")).status, 401);
});

const FORWARD_AUTH = [
	{
		value: "anubis",
		path: "/.within.website/x/cmd/anubis/api/check",
		errorPage: /error_page 401 403 =200 \/\.within\.website\/\?redir=\$request_uri;/u,
		helpers: ["location ^~ /.within.website/ {"],
	},
	{
		value: "tinyauth",
		path: "/tinyauth",
		errorPage: /error_page 401 403 =302 \$redirection_url;/u,
		helpers: ["location = /tinyauth {"],
	},
	{
		value: "oauth2proxy",
		path: "/oauth2/auth",
		errorPage: /error_page 401 = @oauth2_signin;/u,
		helpers: ["location ^~ /oauth2/ {", "location = /oauth2/auth {", "location @oauth2_signin {"],
	},
	{
		value: "voidauth",
		path: "/api/authz/auth-request",
		errorPage: /error_page 401 =302 \$redirection_url;/u,
		helpers: ["location = /api/authz/auth-request {"],
	},
	{
		value: "authelia",
		path: "/internal/authelia/authz",
		errorPage: /error_page 401 =302 \$redirection_url;/u,
		helpers: ["location = /internal/authelia/authz {"],
	},
	{
		value: "authentik",
		path: "/outpost.goauthentik.io/auth/nginx",
		errorPage: /error_page 401 = @goauthentik_proxy_signin;/u,
		helpers: ["location ^~ /outpost.goauthentik.io {", "location @goauthentik_proxy_signin {"],
	},
	{
		value: "authentik-send-basic-auth",
		path: "/outpost.goauthentik.io/auth/nginx",
		errorPage: /error_page 401 = @goauthentik_proxy_signin;/u,
		helpers: ["location ^~ /outpost.goauthentik.io {", "location @goauthentik_proxy_signin {"],
		extra: /proxy_set_header Authorization \$authentik_auth;/u,
	},
];
const providerOf = (value) => (value === "authentik-send-basic-auth" ? "authentik" : value);

for (const provider of FORWARD_AUTH) {
	it(`forward auth ${provider.value}: the main location asks the helper, which proxies to the host's upstream`, async () => {
		const host = await make({
			npmpro_auth_request: provider.value,
			npmpro_auth_request_upstream: "http://auth.internal:9091",
		});
		assert.equal(host.npmpro_auth_request, provider.value);
		const config = await configOf(host);
		const main = block(config, "location / {");
		assert.match(main, new RegExp(`auth_request ${provider.path.replaceAll(".", "\\.")};`, "u"));
		assert.match(main, provider.errorPage);
		if (provider.extra) assert.match(main, provider.extra);
		for (const helper of provider.helpers) assert.ok(config.includes(helper), helper);
		const name = `auth_request_${providerOf(provider.value)}_${host.id}`;
		assert.match(
			config,
			new RegExp(`upstream ${name} \\{\\s+zone ${name} 128k;\\s+server auth\\.internal:9091 resolve;`, "u"),
		);
		assert.match(config, new RegExp(`proxy_pass http://${name}[/;]`, "u"));
		// the helpers of the other providers are not written
		for (const other of FORWARD_AUTH.filter((entry) => providerOf(entry.value) !== providerOf(provider.value))) {
			assert.doesNotMatch(main, new RegExp(`auth_request ${other.path.replaceAll(".", "\\.")};`, "u"));
		}
	});
}

it("forward auth: a host without a provider has no auth_request and no helper location", async () => {
	const config = await configOf(await make());
	assert.doesNotMatch(config, /auth_request \/|\.within\.website|\/oauth2\/|goauthentik|\/tinyauth|authelia\/authz/u);
});

it("forward auth: a client with a valid mTLS certificate skips the check when the host asks for it", async () => {
	const certificate = await addCertificate(ctx.api, { domain: "bypass.example.com" });
	const ca = await addCertificate(ctx.api, { provider: "mtls", domain: "bypass-ca.example.com" });
	const common = {
		certificate_id: certificate,
		npmpro_mtls_certificate_id: ca,
		npmpro_mtls_verify_client_optional: true,
		npmpro_auth_request: "authelia",
		npmpro_auth_request_upstream: "http://auth.internal:9091",
	};
	const bypass = await make({
		...common,
		domain_names: ["bypass.example.com"],
		npmpro_mtls_bypass_auth_request: true,
	});
	assert.equal(bypass.npmpro_mtls_bypass_auth_request, true);
	assert.match(
		block(await configOf(bypass), "location = /internal/authelia/authz {"),
		/if \(\$ssl_client_verify = "SUCCESS"\) \{ return 200; \}/u,
	);
	const plain = await make({ ...common, domain_names: ["nobypass.example.com"] });
	assert.doesNotMatch(await configOf(plain), /ssl_client_verify = "SUCCESS"/u);
	// without a provider the switch is dropped
	const none = await make({
		certificate_id: certificate,
		npmpro_mtls_certificate_id: ca,
		npmpro_mtls_verify_client_optional: true,
		npmpro_mtls_bypass_auth_request: true,
	});
	assert.equal(none.npmpro_mtls_bypass_auth_request, false);
});

it("forward auth: a custom location with its own provider gets the check, its helper and an upstream", async () => {
	const host = await make({
		locations: [
			{
				path: "/secure",
				forward_host: "10.9.8.7",
				forward_port: 80,
				npmpro_auth_request: "authelia",
				npmpro_auth_request_upstream: "http://auth.internal:9091",
			},
			{ path: "/open", forward_host: "10.9.8.6", forward_port: 80 },
		],
	});
	const config = await configOf(host);
	assert.match(
		block(config, 'location "/secure" {'),
		/auth_request \/internal\/authelia\/authz;\s+auth_request_set \$redirection_url/u,
	);
	assert.match(block(config, 'location "/secure" {'), /error_page 401 =302 \$redirection_url;/u);
	assert.doesNotMatch(block(config, 'location "/open" {'), /auth_request/u);
	assert.doesNotMatch(block(config, "location / {"), /auth_request/u);
	assert.ok(config.includes("location = /internal/authelia/authz {"));
	assert.match(
		config,
		new RegExp(`upstream auth_request_authelia_${host.id} \\{[\\s\\S]*server auth\\.internal:9091 resolve;`, "u"),
	);
});

it("forward auth: a location on Same as host gets the host's check, with the host on none it stays public", async () => {
	const host = await make({
		npmpro_auth_request: "authelia",
		npmpro_auth_request_upstream: "http://auth.internal:9091",
		locations: [
			{ path: "/same", forward_host: "10.9.8.5", forward_port: 80, npmpro_auth_request: "global" },
			{ path: "/open", forward_host: "10.9.8.4", forward_port: 80, npmpro_auth_request: "none" },
			{ path: "/default", forward_host: "10.9.8.3", forward_port: 80 },
		],
	});
	const config = await configOf(host);
	assert.match(block(config, 'location "/same" {'), AUTHELIA_CHECK);
	assert.match(block(config, 'location "/default" {'), AUTHELIA_CHECK);
	assert.doesNotMatch(block(config, 'location "/open" {'), ANY_AUTH_REQUEST);
	const stored = await ctx.api.db("npmpro_location").where({ proxy_host_id: host.id }).orderBy("id");
	assert.deepEqual(
		stored.map((row) => row.npmpro_auth_request),
		["global", "none", "global"],
	);

	const bare = await make({
		locations: [{ path: "/same", forward_host: "10.9.8.2", forward_port: 80, npmpro_auth_request: "global" }],
	});
	assert.doesNotMatch(await configOf(bare), NO_PROVIDER_CHECK);
});

it("forward auth: a global location never keeps the mTLS bypass on a host without a provider", async () => {
	const certificate = await addCertificate(ctx.api, { domain: "global-bypass.example.com" });
	const ca = await addCertificate(ctx.api, { provider: "mtls", domain: "global-bypass-ca.example.com" });
	const host = await make({
		domain_names: ["global-bypass.example.com"],
		certificate_id: certificate,
		npmpro_mtls_certificate_id: ca,
		npmpro_mtls_verify_client_optional: true,
		npmpro_mtls_bypass_auth_request: true,
		locations: [{ path: "/g", forward_host: "10.9.8.1", forward_port: 80, npmpro_auth_request: "global" }],
	});
	assert.equal(host.npmpro_mtls_bypass_auth_request, false);
});

it("forward auth: refuses two upstreams for one provider, keeps a stored pair", async () => {
	const pair = {
		npmpro_auth_request: "authelia",
		npmpro_auth_request_upstream: "http://a.internal:9091",
		locations: [
			{
				path: "/b",
				forward_host: "10.9.7.1",
				forward_port: 80,
				npmpro_auth_request: "authelia",
				npmpro_auth_request_upstream: "http://b.internal:9091",
			},
		],
	};
	const refused = await ctx.admin.post(URL, body(pair));
	assert.equal(refused.status, 400, refused.text);
	assert.equal(refused.body.error.message_i18n, "error.auth-request-upstream-conflict");
	assert.equal(refused.body.error.message_values.provider, "authelia");
	// a host stored before the rule keeps saving while its upstreams stay
	const host = await make({ ...pair, locations: [{ ...pair.locations[0], npmpro_auth_request_upstream: "" }] });
	await ctx.api
		.db("npmpro_location")
		.where({ proxy_host_id: host.id })
		.update({ npmpro_auth_request_upstream: "http://b.internal:9091" });
	const kept = await ctx.admin.put(`${URL}/${host.id}`, { forward_port: 8111 });
	assert.equal(kept.status, 200, kept.text);
	const changed = await ctx.admin.put(`${URL}/${host.id}`, {
		npmpro_auth_request_upstream: "http://c.internal:9091",
	});
	assert.equal(changed.status, 400, changed.text);
});

it("forward auth: a stored pair keeps saving when its locations change order", async () => {
	const location = (name, upstream) => ({
		path: `/${name}`,
		forward_host: "10.9.5.1",
		forward_port: 80,
		npmpro_auth_request: "authelia",
		npmpro_auth_request_upstream: upstream,
	});
	const host = await make({
		npmpro_auth_request: "authelia",
		locations: [location("b", ""), location("c", "")],
	});
	for (const name of ["b", "c"]) {
		await ctx.api
			.db("npmpro_location")
			.where({ proxy_host_id: host.id, path: `/${name}` })
			.update({ npmpro_auth_request_upstream: `http://${name}.internal:9091` });
	}
	const reordered = await ctx.admin.put(`${URL}/${host.id}`, {
		locations: [location("c", "http://c.internal:9091"), location("b", "http://b.internal:9091")],
	});
	assert.equal(reordered.status, 200, reordered.text);
});

it("forward auth: a stored conflict on one provider does not hide a new conflict on another", async () => {
	const location = (provider, upstream) => ({
		path: `/${provider}`,
		forward_host: "10.9.6.1",
		forward_port: 80,
		npmpro_auth_request: provider,
		npmpro_auth_request_upstream: upstream,
	});
	const host = await make({
		npmpro_auth_request: "authelia",
		npmpro_auth_request_upstream: "http://a.internal:9091",
		locations: [location("authelia", "")],
	});
	await ctx.api
		.db("npmpro_location")
		.where({ proxy_host_id: host.id })
		.update({ npmpro_auth_request_upstream: "http://b.internal:9091" });
	const kept = await ctx.admin.put(`${URL}/${host.id}`, { forward_port: 8112 });
	assert.equal(kept.status, 200, kept.text);
	const second = await ctx.admin.put(`${URL}/${host.id}`, {
		locations: [
			location("authelia", "http://b.internal:9091"),
			location("authentik", "http://t1.internal:1"),
			{ ...location("authentik", "http://t2.internal:1"), path: "/authentik2" },
		],
	});
	assert.equal(second.status, 400, second.text);
	assert.equal(second.body.error.message_values.provider, "authentik");
});

it("forward auth: an upstream with a variable or a quote is refused", async () => {
	const rows = await countRows(ctx.api, "proxy_host");
	for (const npmpro_auth_request_upstream of [
		"http://a.b:80$x",
		"http://a.b:80;",
		'http://a"b:80',
		"ftp://a.b:80",
		"a.b:80",
	]) {
		const answer = await ctx.admin.post(
			URL,
			body({ npmpro_auth_request: "authelia", npmpro_auth_request_upstream }),
		);
		assert.equal(answer.status, 400, npmpro_auth_request_upstream);
	}
	assert.equal(await countRows(ctx.api, "proxy_host"), rows);
});

it("writes the defaults of a host created with only the required fields", async () => {
	const host = await make();
	const config = await configOf(host);
	const main = block(config, "location / {");
	assert.match(main, /more_set_headers "X-Frame-Options: SAMEORIGIN";/u);
	assert.match(main, /proxy_set_header Accept-Encoding "";/u);
	assert.doesNotMatch(config, /set \$crowdsec_disable_appsec/u);
	assert.doesNotMatch(config, /noindex/u);
	assert.doesNotMatch(config, /proxy_buffering off/u);
	assert.doesNotMatch(config, /proxy_request_buffering off/u);
	assert.doesNotMatch(config, /fancyindex on/u);
	assert.doesNotMatch(config, /auth_basic\s+"/u);
});

it("writes the 404 page of a 404 host as an internal location", async () => {
	const dead = await created(
		await ctx.admin.post("/nginx/dead-hosts", { domain_names: ["dead-page.example.com"] }),
		"dead",
	);
	const config = await read(`data/nginx/dead_host/${dead.id}.conf`);
	assert.match(config, /error_page 404 \/\.npmpro-page\/not-found;\s+location \/ \{\s+return 404;\s+\}/u);
	assert.match(
		config,
		/location = \/\.npmpro-page\/not-found \{[^}]*internal;[^}]*alias \/data\/public\/pages\/global\/404\.html;/u,
	);
});

it("appends the request path to a redirection only when preserve_path is set", async () => {
	const keep = await created(
		await ctx.admin.post("/nginx/redirection-hosts", {
			domain_names: ["keep-path.example.com"],
			forward_domain_name: "t.example.org",
			forward_scheme: "https",
			preserve_path: true,
		}),
		"redirect",
	);
	assert.match(
		await read(`data/nginx/redirection_host/${keep.id}.conf`),
		/return 302 https:\/\/t\.example\.org\$request_uri;/u,
	);
	const drop = await created(
		await ctx.admin.post("/nginx/redirection-hosts", {
			domain_names: ["drop-path.example.com"],
			forward_domain_name: "t.example.org",
			forward_scheme: "https",
		}),
		"redirect",
	);
	const config = await read(`data/nginx/redirection_host/${drop.id}.conf`);
	assert.match(config, /return 302 https:\/\/t\.example\.org;/u);
	assert.doesNotMatch(config, /request_uri;\s+\}/u);
});

it("writes a UDP stream without TCP options and its upstream with the proxy_pass that uses it", async () => {
	const udp = await created(
		await ctx.admin.post("/nginx/streams", {
			incoming_port: "9800",
			forwarding_host: "10.0.6.1",
			forwarding_port: "53",
			udp_forwarding: true,
		}),
		"udp",
	);
	const config = await read(`data/nginx/stream/${udp.id}.conf`);
	assert.match(config, /# 9800 TCP: false UDP: true/u);
	assert.match(
		config,
		new RegExp(
			`upstream stream_upstream_${udp.id} \\{\\s+zone stream_upstream_${udp.id} 128k;\\s+server 10\\.0\\.6\\.1:53 resolve;`,
			"u",
		),
	);
	assert.match(config, /listen 0\.0\.0\.0:9800 udp reuseport;/u);
	assert.match(config, /listen \[::\]:9800 udp reuseport;/u);
	assert.match(config, new RegExp(`proxy_pass stream_upstream_${udp.id};`, "u"));
	assert.doesNotMatch(config, /deferred|so_keepalive|\sssl\s/u);
});

const limitedManager = () =>
	ctx.api.limited({ visibility: "user", proxy_hosts: "manage", access_lists: "view", certificates: "view" });

// forward_host values with a request variable, as a user with only the proxy hosts manage permission can send them
const VARIABLE_FORMS = [
	["a variable in the forward path", "app.internal/$http_x_foo"],
	[
		"a variable in a cu_ upstream name (nginx picks the upstream or the host to resolve per request)",
		"cu_$http_x_foo",
	],
	["a variable in a cu_ upstream name with a path", "cu_a$http_x_foo/p"],
];
for (const [label, forwardHost] of VARIABLE_FORMS) {
	it(`refuses ${label}, on the host`, async () => {
		const user = await limitedManager();
		const answer = await user.post(URL, body({ forward_host: forwardHost }));
		assert.equal(answer.status, 400, answer.text);
	});
	it(`refuses ${label}, in a custom location`, async () => {
		const user = await limitedManager();
		const answer = await user.post(URL, body({ locations: [{ path: "/p", forward_host: forwardHost }] }));
		assert.equal(answer.status, 400, answer.text);
	});
}

it("refuses a variable in the host part of the forward host", async () => {
	const user = await limitedManager();
	const answer = await user.post(URL, body({ forward_host: "$http_x_foo" }));
	assert.equal(answer.status, 400, answer.text);
});

it("lets an administrator save a request variable in the forward host, on the host and in a location", async () => {
	const host = await ctx.admin.post(URL, body({ forward_host: "cu_$http_x_foo" }));
	assert.equal(host.status, 201, host.text);
	const location = await ctx.admin.post(
		URL,
		body({ locations: [{ path: "/p", forward_host: "app.internal/$http_x_foo" }] }),
	);
	assert.equal(location.status, 201, location.text);
});

it("lets a limited user keep a request variable an administrator set, and refuses to change it", async () => {
	const user = await limitedManager();
	const own = await ctx.admin.post(URL, body({ forward_host: "cu_$http_x_foo" }));
	assert.equal(own.status, 201, own.text);
	const stored = await ctx.api.db("proxy_host").where({ id: own.body.id }).first();
	await ctx.api.db("proxy_host").where({ id: stored.id }).update({ owner_user_id: user.user.id });
	assert.equal((await user.put(`${URL}/${stored.id}`, { forward_host: "cu_$http_x_foo" })).status, 200);
	assert.equal((await user.put(`${URL}/${stored.id}`, { forward_host: "cu_$http_x_bar" })).status, 400);
});
