import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { addCertificate, countRows, created, fileExists, listDir } from "./support/hosts.js";

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
const configOf = async (host) => ctx.api.read(confOf(host.id));
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
	assert.match(config, /location \/\.well-known\/acme-challenge\/ \{\s+root \/data\/public\/acme-challenge;/u);
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

it("redirects HTTP to HTTPS when SSL is forced, and writes HSTS with or without subdomains", async () => {
	const certificate = await addCertificate(ctx.api, { domain: "hsts.example.com" });
	const forced = await make({ domain_names: ["hsts.example.com"], certificate_id: certificate, ssl_forced: true });
	const forcedConfig = await configOf(forced);
	assert.match(
		forcedConfig,
		/if \(\$scheme = "http"\) \{\s+return 301 https:\/\/\$host\$is_request_port\$request_port\$request_uri;/u,
	);
	assert.match(forcedConfig, /if \(\$http_x_forwarded_proto = "http"\) \{\s+return 301 https:/u);
	assert.match(forcedConfig, /more_clear_headers "Strict-Transport-Security";/u);
	assert.doesNotMatch(forcedConfig, /more_set_headers "Strict-Transport-Security/u);
	const hsts = await ctx.admin.put(`${URL}/${forced.id}`, { hsts_enabled: true });
	assert.equal(hsts.status, 200, hsts.text);
	assert.match(await configOf(forced), /more_set_headers "Strict-Transport-Security: \$hsts_header";/u);
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
	assert.match(config, /allow 10\.1\.0\.0\/16;/u);
	assert.match(config, /deny all;/u);
	assert.match(config, /satisfy any;/u);
	assert.match(config, /proxy_set_header Authorization "";/u);
	const passwords = await ctx.api.read(`data/access/${list.body.id}`);
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
	const merged = await ctx.api.read(file.slice(1));
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

it("writes the advanced config of a redirection host and a 404 host into their server block", async () => {
	const redirect = await created(
		await ctx.admin.post("/nginx/redirection-hosts", {
			domain_names: ["cfg-r.example.com"],
			forward_domain_name: "t.example.org",
			forward_http_code: 308,
			advanced_config: "add_header X-R yes;",
		}),
		"redirect",
	);
	const redirectConfig = await ctx.api.read(`data/nginx/redirection_host/${redirect.id}.conf`);
	assert.match(
		redirectConfig,
		/return 308 \$scheme:\/\/t\.example\.org;[\s\S]*add_header X-R yes;[\s\S]*server_redirect\.conf/u,
	);
	const dead = await created(
		await ctx.admin.post("/nginx/dead-hosts", {
			domain_names: ["cfg-d.example.com"],
			advanced_config: "add_header X-D yes;",
		}),
		"dead",
	);
	assert.match(await ctx.api.read(`data/nginx/dead_host/${dead.id}.conf`), /return 404;[\s\S]*add_header X-D yes;/u);
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
	const config = await ctx.api.read(`data/nginx/redirection_host/${redirect.id}.conf`);
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
	assert.match(await ctx.api.read(`data/nginx/dead_host/${dead.id}.conf`), /return 301 https:/u);
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
	const config = await ctx.api.read(`data/nginx/stream/${stream.id}.conf`);
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
