// Part of the image smoke test (.github/workflows/docker.yml): creates one host of each type through the API of a
// running NPMpro, and fails unless nginx accepted each of them. A host with a broken directive must come back offline,
// which proves the check can see a failure.
// Usage: CHECK_PASSWORD=... node .github/scripts/config-check.js <base URL>
// The instance must already be set up (the CSP check does that). Needs openssl.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const [base = "https://127.0.0.1:81"] = process.argv.slice(2);
const password = process.env.CHECK_PASSWORD;
if (!password) throw new Error("CHECK_PASSWORD is not set");

let cookie = "";

async function call(method, path, body) {
	const headers = { cookie };
	const isForm = body instanceof FormData;
	if (body !== undefined && !isForm) headers["content-type"] = "application/json";
	const payload = body === undefined || isForm ? body : JSON.stringify(body);
	const answer = await fetch(`${base}/api${path}`, { method, headers, body: payload });
	const text = await answer.text();
	return {
		status: answer.status,
		text,
		json: text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : null,
		answer,
	};
}

async function must(method, path, body) {
	const done = await call(method, path, body);
	if (done.status < 200 || done.status >= 300) throw new Error(`${method} ${path}: ${done.status} ${done.text}`);
	return done.json;
}

async function login() {
	const done = await call("POST", "/tokens", { identity: "admin@example.com", secret: password });
	if (done.status !== 200) throw new Error(`login: ${done.status} ${done.text}`);
	cookie = done.answer.headers
		.getSetCookie()
		.map((line) => line.split(";")[0])
		.join("; ");
	if (!cookie) throw new Error("login: no cookie");
}

// A self-signed certificate, uploaded as the server certificate of a host ("other", with its key) or as the CA that
// checks client certificates ("mtls", certificate only)
async function uploadCertificate(provider, niceName, subject, san) {
	const dir = mkdtempSync(join(tmpdir(), "config-check-"));
	const certificate = join(dir, "cert.pem");
	const key = join(dir, "key.pem");
	execFileSync("openssl", [
		"req",
		"-x509",
		"-newkey",
		"ec",
		"-pkeyopt",
		"ec_paramgen_curve:prime256v1",
		"-nodes",
		"-days",
		"30",
		"-subj",
		subject,
		...(san ? ["-addext", san] : []),
		"-keyout",
		key,
		"-out",
		certificate,
	]);
	const row = await must("POST", "/nginx/certificates", { provider, nice_name: niceName });
	const form = new FormData();
	form.append("certificate", new Blob([readFileSync(certificate)]), "certificate.pem");
	if (provider === "other") form.append("certificate_key", new Blob([readFileSync(key)]), "certificate_key.pem");
	await must("POST", `/nginx/certificates/${row.id}/upload`, form);
	return row.id;
}

async function stateOf(type, id) {
	return must("GET", `/nginx/${type}/${id}`);
}

await login();
const certificateId = await uploadCertificate(
	"other",
	"config check",
	"/CN=check.example.com",
	"subjectAltName=DNS:*.check.example.com",
);
const mtlsCaId = await uploadCertificate("mtls", "config check client CA", "/CN=config check client CA");
const list = await must("POST", "/nginx/access-lists", {
	name: "config check",
	satisfy_any: true,
	items: [{ username: "check", password: "config-check-password" }],
	clients: [{ address: "10.0.0.0/8", directive: "allow" }],
});

const tls = { certificate_id: certificateId, ssl_forced: true, hsts_enabled: true, hsts_subdomains: true };
const plainProxy = (name) => ({
	domain_names: [`${name}.check.example.com`],
	forward_scheme: "http",
	forward_host: "127.0.0.1",
	forward_port: 8080,
});
// every npmpro_auth_request value except "none", each with an upstream of its own so no Forward authentication
// default is needed
const authValues = [
	"anubis",
	"tinyauth",
	"oauth2proxy",
	"voidauth",
	"authelia",
	"authentik",
	"authentik-send-basic-auth",
];
const authUpstream = "http://127.0.0.1:9000";
const hosts = [
	[
		"proxy-hosts",
		"proxy with TLS, HTTP/3, access list, advanced and location config, a location, noindex, DENY, upstream compression, no response buffering",
		{
			...tls,
			domain_names: ["proxy.check.example.com"],
			forward_scheme: "http",
			forward_host: "127.0.0.1",
			forward_port: 8080,
			npmpro_http3_support: true,
			npmpro_access_list_type: "custom",
			npmpro_access_list_ids: [list.id],
			advanced_config: "add_header X-Config-Check yes;",
			npmpro_location_config: "add_header X-Location-Check yes;",
			npmpro_noindex: true,
			npmpro_x_frame_options: "DENY",
			npmpro_upstream_compression: true,
			npmpro_proxy_response_buffering: true,
			locations: [{ path: "/app", forward_scheme: "http", forward_host: "127.0.0.1", forward_port: 8081 }],
		},
	],
	[
		"proxy-hosts",
		"path host with fancyindex",
		{
			domain_names: ["files.check.example.com"],
			forward_scheme: "path",
			forward_host: "/var/www/check",
			npmpro_fancyindex: true,
		},
	],
	[
		"proxy-hosts",
		"proxy with X-Frame-Options from the upstream",
		{ ...plainProxy("frame"), npmpro_x_frame_options: "upstream" },
	],
	["proxy-hosts", "proxy with X-Frame-Options removed", { ...plainProxy("noframe"), npmpro_x_frame_options: "none" }],
	[
		"proxy-hosts",
		"proxy with mTLS required",
		{ ...tls, ...plainProxy("mtls"), npmpro_mtls_certificate_id: mtlsCaId },
	],
	[
		"proxy-hosts",
		"proxy with optional mTLS, Authelia and the mTLS bypass of the auth request",
		{
			...tls,
			...plainProxy("mtls-bypass"),
			npmpro_mtls_certificate_id: mtlsCaId,
			npmpro_mtls_verify_client_optional: true,
			npmpro_mtls_bypass_auth_request: true,
			npmpro_auth_request: "authelia",
			npmpro_auth_request_upstream: authUpstream,
		},
	],
	...authValues.map((value) => [
		"proxy-hosts",
		`proxy with auth request ${value}`,
		{ ...plainProxy(`auth-${value}`), npmpro_auth_request: value, npmpro_auth_request_upstream: authUpstream },
	]),
	[
		"proxy-hosts",
		"plain proxy",
		{
			domain_names: ["plain.check.example.com"],
			forward_scheme: "http",
			forward_host: "127.0.0.1",
			forward_port: 8080,
		},
	],
	[
		"redirection-hosts",
		"redirection",
		{
			...tls,
			domain_names: ["redirect.check.example.com"],
			forward_domain_name: "target.example.org",
			forward_scheme: "https",
			forward_http_code: 301,
			preserve_path: true,
			npmpro_http3_support: true,
		},
	],
	["dead-hosts", "dead host", { ...tls, domain_names: ["dead.check.example.com"], npmpro_http3_support: true }],
	[
		"streams",
		"stream TCP and UDP with TLS",
		{
			incoming_port: "9443",
			forwarding_host: "127.0.0.1",
			forwarding_port: "8080",
			tcp_forwarding: true,
			udp_forwarding: true,
			certificate_id: certificateId,
		},
	],
	[
		"streams",
		"stream with a port range",
		{
			incoming_port: "9500-9510",
			forwarding_host: "127.0.0.1",
			forwarding_port: "$server_port",
			tcp_forwarding: true,
			udp_forwarding: false,
		},
	],
];

const failures = [];
let checked = 0;
for (const [type, label, body] of hosts) {
	const made = await must("POST", `/nginx/${type}`, body);
	const row = await stateOf(type, made.id);
	checked += 1;
	if (row.npmpro_nginx_online !== true) failures.push(`${label}: ${row.npmpro_nginx_err}`);
	else console.log(`online: ${label}`);
}

const broken = await must("POST", "/nginx/proxy-hosts", {
	domain_names: ["broken.check.example.com"],
	forward_scheme: "http",
	forward_host: "127.0.0.1",
	forward_port: 8080,
	advanced_config: "this_is_not_a_directive;",
});
const brokenState = await stateOf("proxy-hosts", broken.id);
if (brokenState.npmpro_nginx_online !== false) failures.push("negative control: a broken directive came back online");
else console.log("negative control: refused as it should be");
await must("DELETE", `/nginx/proxy-hosts/${broken.id}`);

if (checked !== hosts.length) failures.push(`checked ${checked} of ${hosts.length} hosts`);
if (failures.length > 0) {
	console.error(failures.join("\n"));
	process.exit(1);
}
console.log(`${checked} hosts accepted by nginx`);
