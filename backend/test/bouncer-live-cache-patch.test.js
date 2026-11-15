import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";

const ROOT = path.join(import.meta.dirname, "../..");
const PATCH = readFileSync(path.join(ROOT, "patches/lua-cs-bouncer-live-failure-cache.patch"), "utf8");
const DOCKERFILE = readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
const PATCH_FILE = /^\+\+\+ b\/(?<file>\S+)$/gmu;
const CALL = "+    cache_failure(ip, cache_expiration)";
const FAILURE_RETURN = "     return true, nil, nil, ";
const SET_CALL = /:set\(/u;

const lines = PATCH.split("\n");
const added = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++"));

it("patches only live.lua and removes no line", () => {
	const files = [...PATCH.matchAll(PATCH_FILE)].map((m) => m.groups.file);
	assert.deepEqual(files, ["lib/plugins/crowdsec/live.lua"]);
	assert.equal(
		lines.some((line) => line.startsWith("-") && !line.startsWith("---")),
		false,
	);
});

it("adds the cache_failure function and three calls, nothing else", () => {
	const code = added.filter((line) => !line.startsWith("+--") && line.trim() !== "+");
	assert.deepEqual(code, [
		"+local function cache_failure(ip, cache_expiration)",
		'+  local key, _ = utils.item_to_string(ip, "ip")',
		"+  if key == nil or (tonumber(cache_expiration) or 0) <= 0 then",
		"+    return",
		"+  end",
		'+  local ok, err = live.cache:add("decision_cache/" .. key, "none", cache_expiration, 1)',
		'+  if not ok and err ~= "exists" then',
		`+    ngx.log(ngx.ERR, "[Crowdsec] failed to cache the failed LAPI answer for '" .. ip .. "': " .. tostring(err))`,
		"+  end",
		"+end",
		CALL,
		CALL,
		CALL,
	]);
});

it("puts each call right before a failure return", () => {
	const calls = lines.map((line, i) => (line === CALL ? i : -1)).filter((i) => i >= 0);
	assert.equal(calls.length, 3);
	for (const i of calls) {
		assert.ok(lines[i + 1].startsWith(FAILURE_RETURN), lines[i + 1]);
	}
});

it("stores the not blocking entry with add, never set", () => {
	assert.equal(
		added.some((line) => SET_CALL.test(line)),
		false,
	);
	assert.ok(added.some((line) => line.includes(':add("decision_cache/" .. key, "none", cache_expiration, 1)')));
});

it("applies the patch in the image build after the request id patch and before the files move", () => {
	assert.ok(DOCKERFILE.includes("source=patches/lua-cs-bouncer-live-failure-cache.patch,target=/tmp/"), "bind mount");
	const clone = DOCKERFILE.indexOf('"$LCSB_VER" /src/lua-cs-bouncer');
	const first = DOCKERFILE.indexOf("git apply /tmp/lua-cs-bouncer-appsec-request-id.patch");
	const apply = DOCKERFILE.indexOf("git apply /tmp/lua-cs-bouncer-live-failure-cache.patch");
	const move = DOCKERFILE.indexOf("mv /src/lua-cs-bouncer/lib/*");
	assert.ok(clone >= 0 && first > clone, "request id patch after clone");
	assert.ok(apply > first, "apply after the request id patch");
	assert.ok(move > apply, "move after apply");
});
