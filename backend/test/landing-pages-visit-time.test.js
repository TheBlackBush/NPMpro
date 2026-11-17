import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { VISIT_TIME_CONF, VISIT_TIMES, visitTimeConf, visitTimeOf } from "../lib/landing-pages/visit-time.js";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

it("knows the three choices, utc by default and for anything else", () => {
	assert.deepEqual(VISIT_TIMES, ["utc", "local", "local-utc"]);
	for (const value of VISIT_TIMES) assert.equal(visitTimeOf({ visit_time: value }), value);
	for (const stored of [null, undefined, {}, { visit_time: "LOCAL" }, { visit_time: 'x"; }' }, { visit_time: 1 }]) {
		assert.equal(visitTimeOf(stored), "utc", JSON.stringify(stored));
	}
});

it("writes a map include that only ever holds one of the three choices", () => {
	assert.equal(
		visitTimeConf("local-utc"),
		'# the visit time of the built-in landing pages (Settings, Landing pages): utc, local or local-utc\nmap $host $npmpro_visit_time {\n  default "local-utc";\n}\n',
	);
	assert.equal(visitTimeConf('local"; } include /etc/passwd; #'), visitTimeConf("utc"));
	assert.equal(VISIT_TIME_CONF, "/data/npmpro/nginx/landing-pages.conf");
});

it("nginx.conf includes the file and data-setup.sh creates it with the utc text when it is missing", () => {
	assert.match(
		read("rootfs/usr/local/nginx/conf/nginx.conf"),
		/^ {2}include \/data\/npmpro\/nginx\/landing-pages\.conf;$/mu,
	);
	const dataSetup = read("rootfs/usr/local/bin/data-setup.sh");
	assert.ok(
		dataSetup.includes(
			`if [ ! -e /data/npmpro/nginx/landing-pages.conf ]; then\n    cat > /data/npmpro/nginx/landing-pages.conf <<'EOF'\n${visitTimeConf("utc")}EOF\nfi\n`,
		),
	);
});
