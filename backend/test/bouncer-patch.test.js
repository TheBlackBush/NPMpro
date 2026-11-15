import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";

const ROOT = path.join(import.meta.dirname, "../..");
const PATCH = readFileSync(path.join(ROOT, "patches/lua-cs-bouncer-appsec-request-id.patch"), "utf8");
const DOCKERFILE = readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
const PATCH_FILE = /^\+\+\+ b\/(?<file>\S+)$/gmu;
const REQUEST_ID_HEADER = /X-Request-Id/iu;
const REQUEST_ID_ASSIGNMENT = /headers\[\s*["']x-request-id["']\s*\]\s*=/iu;

it("patches only the request to the AppSec: the HTTP version, transaction id and request id lines in lib/crowdsec.lua", () => {
	const files = [...PATCH.matchAll(PATCH_FILE)].map((m) => m.groups.file);
	assert.deepEqual(files, ["lib/crowdsec.lua"]);
	const lines = PATCH.split("\n");
	const added = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++"));
	const code = added.filter((line) => !line.startsWith("+  --") && line.trim() !== "+");
	assert.deepEqual(code, [
		'+local APPSEC_HTTP_VERSION_HEADER = "x-crowdsec-appsec-http-version"',
		'+local APPSEC_TRANSACTION_ID_HEADER = "x-crowdsec-appsec-transaction-id"',
		"+  local http_version = ngx.req.http_version()",
		"+  if http_version and http_version >= 1 then",
		'+    headers[APPSEC_HTTP_VERSION_HEADER] = string.format("%d", math.floor(http_version * 10 + 0.5))',
		"+  else",
		"+    headers[APPSEC_HTTP_VERSION_HEADER] = nil",
		"+  end",
		"+  headers[APPSEC_TRANSACTION_ID_HEADER] = ngx.var.request_id",
		'+  headers["x-npmpro-request-id"] = ngx.var.request_id',
	]);
	assert.equal(
		lines.some((line) => line.startsWith("-") && !line.startsWith("---")),
		false,
	);
});

it("leaves the client's X-Request-Id in the request to the AppSec: the patch never assigns it", () => {
	assert.equal(REQUEST_ID_ASSIGNMENT.test(PATCH), false);
});

it("sends the request id as X-Npmpro-Request-Id from ngx.var.request_id, the key a client-sent header has", () => {
	const lines = PATCH.split("\n").filter((line) => line.startsWith("+") && line.includes("x-npmpro-request-id"));
	assert.deepEqual(lines, ['+  headers["x-npmpro-request-id"] = ngx.var.request_id']);
});

it("applies the patch to the bouncer in the image build, after the clone and before the files move", () => {
	assert.ok(DOCKERFILE.includes("source=patches/lua-cs-bouncer-appsec-request-id.patch,target=/tmp/"), "bind mount");
	const clone = DOCKERFILE.indexOf('"$LCSB_VER" /src/lua-cs-bouncer');
	const apply = DOCKERFILE.indexOf("git apply /tmp/lua-cs-bouncer-appsec-request-id.patch");
	const move = DOCKERFILE.indexOf("mv /src/lua-cs-bouncer/lib/*");
	assert.ok(clone >= 0, "clone line");
	assert.ok(apply > clone, "apply after clone");
	assert.ok(move > apply, "move after apply");
});

it("keeps the upstream request untouched: no request id header in the nginx configs or templates", () => {
	for (const file of ["rootfs/usr/local/nginx/conf/crowdsec-bouncer.conf", "backend/templates/proxy_host.conf"]) {
		assert.equal(REQUEST_ID_HEADER.test(readFileSync(path.join(ROOT, file), "utf8")), false, file);
	}
});
