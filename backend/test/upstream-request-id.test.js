import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";

const ROOT = path.join(import.meta.dirname, "../..");
const CONF_DIRS = ["rootfs/usr/local/nginx/conf", "backend/templates"];
// stream proxying is TCP/UDP: no HTTP headers to remove
const EXEMPT = new Set(["backend/templates/stream.conf"]);
const PASS = /^\s*(?<directive>proxy_pass|grpc_pass|fastcgi_pass|uwsgi_pass|scgi_pass|memcached_pass)\s/u;
const LOCATION = /^\s*location\b/u;
const LIQUID = /\{%.*?%\}|\{\{.*?\}\}/gu;
const QUOTED = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/gu;
const COMMENT = /#.*$/u;
const TEMPLATE_VERSION = /^TV="(?<version>\d+)"$/mu;
const REQUIRED = {
	proxy_pass: "include proxy-headers.conf;",
	grpc_pass: "include grpc-headers.conf;",
	fastcgi_pass: 'fastcgi_param HTTP_X_NPMPRO_REQUEST_ID "" if_not_empty;',
};

const confFiles = (dir) =>
	readdirSync(path.join(ROOT, dir), { recursive: true })
		.filter((name) => name.endsWith(".conf"))
		.map((name) => path.join(dir, name));

const strip = (line) => line.replace(LIQUID, "").replace(QUOTED, '""').replace(COMMENT, "");
const count = (text, char) => text.split(char).length - 1;

// the lines of the location a pass line sits in, at its own level (an if block inside the location counts as the
// location: nginx inherits the location's proxy_set_header into it); nested blocks closed above it are skipped
const ownLocation = (lines, index) => {
	const own = [];
	let depth = 0;
	for (let i = index - 1; i >= 0; i--) {
		const code = strip(lines[i]);
		const net = count(code, "}") - count(code, "{");
		if (depth > 0 || net > 0) {
			depth += net;
			continue;
		}
		if (net < 0) {
			if (LOCATION.test(code)) {
				return own;
			}
			continue;
		}
		own.push(lines[i].trim());
	}
	return null;
};

// every pass line whose location lacks the line that removes X-Npmpro-Request-Id
const missing = (file, text) => {
	const lines = text.split("\n");
	const found = [];
	const bad = [];
	lines.forEach((line, index) => {
		const directive = PASS.exec(strip(line))?.groups?.directive;
		if (!directive) {
			return;
		}
		found.push(`${file}:${index + 1}`);
		const own = ownLocation(lines, index);
		if (!(own && REQUIRED[directive] && own.includes(REQUIRED[directive]))) {
			bad.push(`${file}:${index + 1} ${directive}`);
		}
	});
	return { found, bad };
};

it("removes a client-sent X-Npmpro-Request-Id in the shared proxy and gRPC includes", () => {
	const proxy = readFileSync(path.join(ROOT, "rootfs/usr/local/nginx/conf/proxy-headers.conf"), "utf8");
	const grpc = readFileSync(path.join(ROOT, "rootfs/usr/local/nginx/conf/grpc-headers.conf"), "utf8");
	assert.ok(proxy.split("\n").includes('proxy_set_header X-Npmpro-Request-Id "";'));
	assert.ok(grpc.split("\n").includes('grpc_set_header X-Npmpro-Request-Id "";'));
});

it("every location that passes a request on removes X-Npmpro-Request-Id", () => {
	const all = { found: [], bad: [] };
	for (const file of CONF_DIRS.flatMap(confFiles)) {
		if (EXEMPT.has(file)) {
			continue;
		}
		const { found, bad } = missing(file, readFileSync(path.join(ROOT, file), "utf8"));
		all.found.push(...found);
		all.bad.push(...bad);
	}
	assert.deepEqual(all.bad, []);
	// 7 in npmpro.conf, 10 in proxy_host.conf, 3 in the custom location: a scanner that finds fewer is broken
	assert.ok(all.found.length >= 20, `found ${all.found.length}: ${all.found.join(", ")}`);
});

it("the scan catches a location without the line, and one that only a closed sibling location has", () => {
	const sample = [
		"server {",
		"  location /a {",
		"    include proxy-headers.conf;",
		"    proxy_pass http://a;",
		"  }",
		"  location /b {",
		"    location /b/c {",
		"      include proxy-headers.conf;",
		"    }",
		"    proxy_pass http://b;",
		"  }",
		"  location ~ \\.php$ {",
		"    include fastcgi.conf;",
		"    fastcgi_pass unix:/run/php.sock;",
		"  }",
		"}",
	].join("\n");
	assert.deepEqual(missing("sample.conf", sample).bad, ["sample.conf:10 proxy_pass", "sample.conf:14 fastcgi_pass"]);
});

it("stream.conf, exempt from the scan, has no HTTP location", () => {
	const stream = readFileSync(path.join(ROOT, "backend/templates/stream.conf"), "utf8");
	assert.equal(
		stream.split("\n").some((line) => LOCATION.test(line)),
		false,
	);
});

it("bumps the template version for the changed host configs", () => {
	const version = TEMPLATE_VERSION.exec(readFileSync(path.join(ROOT, "rootfs/usr/local/bin/envs.sh"), "utf8"))?.groups
		.version;
	assert.ok(Number(version) >= 26, `TV is ${version}`);
});
