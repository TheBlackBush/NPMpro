import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";
import { ACCESS_FIELDS } from "../lib/log-format.js";

const ROOT = path.join(import.meta.dirname, "../..");
const DINIT = readFileSync(path.join(ROOT, "rootfs/etc/dinit.d/goaccess"), "utf8");
const RUN = readFileSync(path.join(ROOT, "rootfs/usr/local/bin/goaccess-run.sh"), "utf8");
const CLASSIC = '[%d:%t %^] %v %h %T "%r" %s %b "%R" "%u" "%e" "%M" %K %k %g %C';
const CLASSIC_NAMES = [
	"time_local",
	"host",
	"remote_addr",
	"request_time",
	"request",
	"status",
	"bytes_sent",
	"http_referer",
	"http_user_agent",
	"remote_user",
	"sent_http_content_type",
	"ssl_protocol",
	"ssl_cipher",
	"ssl_curve",
	"upstream_cache_status",
];
const SELECT = /grep -qs " ajson;" \/data\/npmpro\/nginx\/access-log\.conf/u;
const CLASSIC_IN_RUN = /format='(?<classic>\[[^']*)'/u;

it("the dinit file leaves the log format to goaccess-run.sh", () => {
	assert.equal(DINIT.includes("--log-format"), false);
});

it("goaccess-run.sh picks the format from the access include", () => {
	assert.match(RUN, SELECT);
	assert.ok(RUN.indexOf('set -- --log-format="$format"') < RUN.indexOf('if [ -n "$NPMPRO_NGINX_WORKER_GID" ]'));
});

it("the classic format is the one the dinit file had", () => {
	assert.equal(CLASSIC_IN_RUN.exec(RUN)?.groups.classic, CLASSIC);
});

it("the JSON format maps every key to the specifier of the classic format", () => {
	const json = RUN.split("format='")
		.find((part) => part.startsWith("{"))
		?.split("'")[0];
	const parsed = JSON.parse(json);
	const specifiers = CLASSIC.replace(/"/gu, "").split("] ")[1].split(" ");
	const byName = {
		time_local: "%d:%t %^",
		...Object.fromEntries(CLASSIC_NAMES.slice(1).map((name, i) => [name, specifiers[i]])),
	};
	const names = ACCESS_FIELDS.map((item) => item.name);
	for (const [key, specifier] of Object.entries(parsed)) {
		assert.ok(names.includes(key), key);
		assert.equal(specifier, byName[key], key);
	}
	assert.deepEqual(
		Object.keys(parsed),
		CLASSIC_NAMES.filter((name) => name !== "ssl_curve"),
	);
});
