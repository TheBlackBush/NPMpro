import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { startApi } from "./support/api.js";
import { created, fileExists, reloads } from "./support/hosts.js";
import { withDatabaseType } from "./support/mmdb.js";

const LISTS = "/nginx/access-lists";
const HOSTS = "/nginx/proxy-hosts";
let api;
let admin;
let counter = 0;

const makeList = async (username = "bob") => {
	counter += 1;
	return created(
		await admin.post(LISTS, {
			name: `list ${counter}`,
			items: [{ username, password: "bobs-password-1" }],
			clients: [{ address: "10.1.0.0/16", directive: "allow" }],
		}),
		"list",
	);
};
const makeHost = async (ids, overrides = {}) => {
	counter += 1;
	return created(
		await admin.post(HOSTS, {
			domain_names: [`al${counter}.example.com`],
			forward_scheme: "http",
			forward_host: "10.0.0.1",
			forward_port: 80,
			npmpro_access_list_type: "custom",
			npmpro_access_list_ids: ids,
			...overrides,
		}),
		"host",
	);
};
const nginxTests = async () => (await api.outside.calls()).filter((line) => line === "nginx -tq").length;
const row = (id) => api.db("proxy_host").where({ id }).first();
const config = (id) => `data/nginx/proxy_host/${id}.conf`;
const healthyNginx = () => api.outside.hookCommand("nginx", "#!/bin/sh\nexit 0\n");
const brokenNginx = () =>
	api.outside.hookCommand(
		"nginx",
		`#!/bin/sh\nif grep -rq BADHOST --include='*.conf' "${api.root}/data/nginx/proxy_host"; then echo "BADHOST is not valid" >&2; exit 1; fi\n`,
	);

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());
beforeEach(async () => {
	await healthyNginx();
	await api.outside.clearCalls();
});

it("tests nginx once for all hosts of a list, and reloads once", async () => {
	const list = await makeList();
	const hosts = [await makeHost([list.id]), await makeHost([list.id]), await makeHost([list.id])];
	await api.outside.clearCalls();
	const reloadsBefore = reloads(api);
	assert.equal((await admin.put(`${LISTS}/${list.id}`, { name: "renamed once" })).status, 200);
	assert.equal(await nginxTests(), 1);
	assert.equal(reloads(api), reloadsBefore + 1);
	for (const host of hosts) assert.equal((await row(host.id)).npmpro_nginx_online, 1);
});

it("names the broken host after a failed test, keeps the others online and writes its .err", async () => {
	const list = await makeList();
	const good = await makeHost([list.id]);
	const bad = await makeHost([list.id]);
	const other = await makeHost([list.id]);
	// the previous config of the second host is fine, its new one (rendered from the row) is not
	await api.db("proxy_host").where({ id: bad.id }).update({ advanced_config: "# BADHOST" });
	await brokenNginx();
	await api.outside.clearCalls();
	assert.equal((await admin.put(`${LISTS}/${list.id}`, { name: "broken once" })).status, 200);
	assert.equal(await nginxTests(), 4, "one for the batch, then one per host");
	const stored = await row(bad.id);
	assert.equal(stored.npmpro_nginx_online, 0);
	assert.match(stored.npmpro_nginx_err, /BADHOST is not valid/u);
	assert.equal(await fileExists(api, `${config(bad.id)}.err`), true);
	assert.equal(await fileExists(api, config(bad.id)), false);
	for (const host of [good, other]) {
		assert.equal((await row(host.id)).npmpro_nginx_online, 1);
		assert.equal((await row(host.id)).npmpro_nginx_err, "");
		assert.equal(await fileExists(api, config(host.id)), true);
	}
	await api.db("proxy_host").where({ id: bad.id }).delete();
	await api.db("npmpro_proxy_host_access_list").where({ proxy_host_id: bad.id }).delete();
});

it("leaves a disabled host without a config", async () => {
	const list = await makeList();
	const on = await makeHost([list.id]);
	const off = await makeHost([list.id]);
	assert.equal((await admin.post(`${HOSTS}/${off.id}/disable`)).status, 200);
	await api.outside.clearCalls();
	assert.equal((await admin.put(`${LISTS}/${list.id}`, { name: "with a disabled host" })).status, 200);
	assert.equal(await nginxTests(), 1);
	assert.equal(await fileExists(api, config(off.id)), false);
	assert.equal(await fileExists(api, config(on.id)), true);
});

it("runs no nginx test for a list that no enabled host uses, and reloads as before", async () => {
	const list = await makeList();
	const off = await makeHost([list.id]);
	assert.equal((await admin.post(`${HOSTS}/${off.id}/disable`)).status, 200);
	await api.outside.clearCalls();
	const reloadsBefore = reloads(api);
	assert.equal((await admin.put(`${LISTS}/${list.id}`, { name: "no enabled host" })).status, 200);
	assert.equal(await nginxTests(), 0);
	assert.equal(reloads(api), reloadsBefore + 1);
});

it("tests nginx once when a list is deleted, and the hosts turn public", async () => {
	const list = await makeList();
	const hosts = [await makeHost([list.id]), await makeHost([list.id])];
	await api.outside.clearCalls();
	assert.equal((await admin.delete(`${LISTS}/${list.id}`)).status, 200);
	assert.equal(await nginxTests(), 1);
	for (const host of hosts) assert.equal((await row(host.id)).npmpro_access_list_type, "public");
});

it("rewrites the merged access file of a host in a batch", async () => {
	const first = await makeList("first-user");
	const second = await makeList("second-user");
	const host = await makeHost([first.id, second.id]);
	const file = path.join(api.root, `data/access/host-${host.id}`);
	assert.match(await readFile(file, "utf8"), /second-user/u);
	const update = await admin.put(`${LISTS}/${second.id}`, {
		items: [{ username: "third-user", password: "bobs-password-1" }],
	});
	assert.equal(update.status, 200, update.text);
	const text = await readFile(file, "utf8");
	assert.match(text, /third-user/u);
	assert.doesNotMatch(text, /second-user/u);
});

it("sets a host that was offline online again when the batch passes", async () => {
	const list = await makeList();
	const host = await makeHost([list.id]);
	await api.db("proxy_host").where({ id: host.id }).update({ npmpro_nginx_online: 0, npmpro_nginx_err: "old error" });
	assert.equal((await row(host.id)).npmpro_nginx_online, 0);
	assert.equal((await admin.put(`${LISTS}/${list.id}`, { name: "fixed host" })).status, 200);
	const stored = await row(host.id);
	assert.equal(stored.npmpro_nginx_online, 1);
	assert.equal(stored.npmpro_nginx_err, "");
	assert.equal(await fileExists(api, config(host.id)), true);
});

it("tests the batches of two saves one after the other", async () => {
	const lists = [await makeList(), await makeList()];
	for (const list of lists) await makeHost([list.id]);
	const log = path.join(api.root, "fake/overlap.log");
	await api.outside.hookCommand("nginx", `#!/bin/sh\necho start >> "${log}"\nsleep 0.3\necho end >> "${log}"\n`);
	await rm(log, { force: true });
	const answers = await Promise.all(
		lists.map((list) => admin.put(`${LISTS}/${list.id}`, { name: "at the same time" })),
	);
	for (const answer of answers) assert.equal(answer.status, 200);
	const lines = (await readFile(log, "utf8")).trim().split("\n");
	assert.deepEqual(lines, ["start", "end", "start", "end"]);
});

it("keeps the previous configs of the other hosts while a failed batch is checked one by one", async () => {
	const list = await makeList();
	const hosts = [await makeHost([list.id]), await makeHost([list.id]), await makeHost([list.id])];
	// the previous config of the second host is fine, its new one (rendered from the row) is not
	await api.db("proxy_host").where({ id: hosts[1].id }).update({ advanced_config: "# BADHOST" });
	const log = path.join(api.root, "fake/listing.log");
	const dir = path.join(api.root, "data/nginx/proxy_host");
	await api.outside.hookCommand(
		"nginx",
		`#!/bin/sh
ls "${dir}" | tr '\\n' ' ' >> "${log}"
echo >> "${log}"
if grep -rq BADHOST --include='*.conf' "${dir}"; then echo "BADHOST is not valid" >&2; exit 1; fi
`,
	);
	await rm(log, { force: true });
	assert.equal((await admin.put(`${LISTS}/${list.id}`, { name: "previous kept" })).status, 200);
	const ours = new Set(hosts.map((host) => `${host.id}.conf`));
	const listings = (await readFile(log, "utf8")).trim().split("\n");
	assert.equal(listings.length, 4, "one for the batch, then one per host");
	const all = [...ours].sort().join(" ");
	assert.equal(
		listings[1]
			.split(" ")
			.filter((name) => ours.has(name))
			.sort()
			.join(" "),
		all,
		"all previous configs are there for the first check",
	);
	assert.match((await row(hosts[1].id)).npmpro_nginx_err, /BADHOST is not valid/u);
	for (const host of [hosts[0], hosts[2]]) assert.equal((await row(host.id)).npmpro_nginx_online, 1);
	await api.db("proxy_host").where({ id: hosts[1].id }).delete();
	await api.db("npmpro_proxy_host_access_list").where({ proxy_host_id: hosts[1].id }).delete();
});

const GEO_ANY = /npmpro_geo/u;
const GEO_GATE = /npmpro_geo_\d+ = 0/u;
const GEO_GATES = /npmpro_geo_\d+ = 0/gu;
const GATE_LINE = /if \(\$npmpro_geo_(?<id>\d+) = 0\) \{ (?<answer>[^}]+) \}/gu;
const PROXY_PASS = /proxy_pass /u;
const GEO_TARGET = /internal;\s+error_page 403 \/\.npmpro-page\/denied-1;\s+return 403;/u;
const GEO_TARGET_HEADER = /location = \/\.npmpro-geo\/denied-1 \{/u;
const DENIED_PAGE_HEADER = /location = \/\.npmpro-page\/denied-1 \{/u;
const GEO_REWRITE = /rewrite \^ \/\.npmpro-geo\/denied-1\? last;/u;
const TINYAUTH_ERROR_PAGE = /error_page 401 403 =302 \$redirection_url;/u;
const GEO_TARGET_PAGE = /error_page 403 \/\.npmpro-page\/denied-1;/u;
const NEXT_LOCATION = /\n\s*location /u;
// a location from its header to the next line that starts a location (or the end)
const locationBlock = (text, header) => {
	const start = text.indexOf(header);
	if (start < 0) throw new Error(`no ${header} in the config`);
	const rest = text.slice(start + header.length);
	const next = rest.search(NEXT_LOCATION);
	return header + (next < 0 ? rest : rest.slice(0, next));
};
const gateConfig = async (host) => readFile(path.join(api.root, config(host.id)), "utf8");
const setGeo = (id, mode, drop = 0) =>
	api.db("access_list").where({ id }).update({ npmpro_geo_mode: mode, npmpro_geo_drop: drop });

it("renders the country gates of every gated list before the password and IP rules", async () => {
	const a = await makeList();
	const b = await makeList();
	const c = await makeList();
	await setGeo(a.id, "allow");
	await setGeo(c.id, "deny", 1);
	const host = await makeHost([a.id, b.id, c.id], {
		locations: [
			{ path: "/inner", forward_host: "10.0.0.2", npmpro_access_list_type: "global" },
			{
				path: "/.well-known/acme-challenge/",
				location_type: "^~ ",
				forward_host: "10.0.0.3",
				npmpro_access_list_type: "global",
			},
		],
	});
	const text = await gateConfig(host);
	const rootStart = text.indexOf("location / {");
	const root = text.slice(rootStart, text.indexOf("auth_basic ", rootStart));
	const gates = [...root.matchAll(GATE_LINE)];
	assert.deepEqual(
		gates.map((m) => [Number(m.groups.id), m.groups.answer]),
		[
			[a.id, "rewrite ^ /.npmpro-geo/denied-1? last;"],
			[c.id, "return 444;"],
		],
	);
	assert.doesNotMatch(root, new RegExp(`npmpro_geo_${b.id}\\b`, "u"));
	const inner = text.slice(text.indexOf('location "/inner"'));
	assert.equal([...inner.slice(0, inner.indexOf("location ", 10)).matchAll(GEO_GATES)].length, 2);
	const acme = locationBlock(text, 'location ^~ "/.well-known/acme-challenge/"');
	assert.match(acme, PROXY_PASS);
	assert.doesNotMatch(acme, GEO_GATE);
	// the target of the 403 gates answers with the denied page, outside the gated locations
	assert.match(locationBlock(text, "location = /.npmpro-geo/denied-1 {"), GEO_TARGET);
});

it("repeats the gates in the built-in PHP location of a path host", async () => {
	const list = await makeList();
	await setGeo(list.id, "deny");
	const host = await makeHost([list.id], { forward_scheme: "path", forward_host: "/var/www/php", forward_port: 83 });
	const text = await gateConfig(host);
	const php = locationBlock(text, "location ~* [^/]\\.php(?:$|/) {");
	assert.match(
		php,
		new RegExp(`if \\(\\$npmpro_geo_${list.id} = 0\\) \\{ rewrite \\^ /\\.npmpro-geo/denied-1\\? last; \\}`, "u"),
	);
	assert.ok(php.indexOf("npmpro_geo") < php.indexOf("fastcgi_pass"));
});

it("a country only list gets the denied page, and forward authentication keeps it for the gate", async () => {
	// the API needs a usable GeoIP database for a country rule: the users and rules go in the database instead
	const only = await makeList();
	await api.db("access_list_auth").where({ access_list_id: only.id }).delete();
	await api.db("access_list_client").where({ access_list_id: only.id }).delete();
	await setGeo(only.id, "allow");
	const plain = await gateConfig(await makeHost([only.id]));
	assert.match(plain, GEO_TARGET_HEADER);
	assert.match(plain, DENIED_PAGE_HEADER);
	const tiny = await gateConfig(
		await makeHost([only.id], {
			npmpro_auth_request: "tinyauth",
			npmpro_auth_request_upstream: "http://auth.internal:3000",
		}),
	);
	const root = locationBlock(tiny, "location / {");
	assert.match(root, GEO_REWRITE);
	assert.match(root, TINYAUTH_ERROR_PAGE);
	assert.match(locationBlock(tiny, "location = /.npmpro-geo/denied-1 {"), GEO_TARGET_PAGE);
	assert.match(tiny, DENIED_PAGE_HEADER);
});

const SATISFY_ANY = /satisfy any;/u;
const AUTH_BASIC = /auth_basic /u;
const DENIED_ERROR_PAGE = /error_page 401 403 \/\.npmpro-page\/denied-1;/u;
const ACCESS_RULES = /# Access Rules: \d+ total\s+(?<rules>(?:(?:allow|deny) [^;]+;\s*)+)/u;
const ONE_RULE = /(?:allow|deny) [^;]+;/gu;
// D20: a list whose only client rule is deny all refuses every visitor
const loneRuleHost = async (clients, { users = false, satisfyAny = false } = {}) => {
	const now = new Date().toISOString();
	const list = await makeList();
	await api.db("access_list_client").where({ access_list_id: list.id }).delete();
	if (!users) await api.db("access_list_auth").where({ access_list_id: list.id }).delete();
	if (clients.length > 0) {
		await api.db("access_list_client").insert(
			clients.map((c) => ({
				access_list_id: list.id,
				created_on: now,
				modified_on: now,
				meta: "{}",
				...c,
			})),
		);
	}
	await api
		.db("access_list")
		.where({ id: list.id })
		.update({ satisfy_any: satisfyAny ? 1 : 0 });
	return gateConfig(await makeHost([list.id]));
};
const rulesOf = (text) => [...(text.match(ACCESS_RULES)?.groups.rules.matchAll(ONE_RULE) ?? [])].map((m) => m[0]);

it("a list with only deny all refuses every visitor, with the denied page", async () => {
	const text = await loneRuleHost([{ directive: "deny", address: "all" }]);
	assert.deepEqual(rulesOf(text), ["deny all;"]);
	assert.doesNotMatch(text, SATISFY_ANY);
	assert.match(text, DENIED_ERROR_PAGE);
	assert.match(text, DENIED_PAGE_HEADER);
});

it("a list with only deny all and users still lets the password in under satisfy any", async () => {
	const text = await loneRuleHost([{ directive: "deny", address: "all" }], { users: true, satisfyAny: true });
	assert.deepEqual(rulesOf(text), ["deny all;"]);
	assert.match(text, AUTH_BASIC);
	assert.match(text, SATISFY_ANY);
});

it("a list with only deny all and users needs both under satisfy all", async () => {
	const text = await loneRuleHost([{ directive: "deny", address: "all" }], { users: true });
	assert.deepEqual(rulesOf(text), ["deny all;"]);
	assert.match(text, AUTH_BASIC);
	assert.doesNotMatch(text, SATISFY_ANY);
});

it("a deny all list next to an allow all list with users and satisfy any denies, the password passes", async () => {
	const deny = await makeList();
	await api.db("access_list_client").where({ access_list_id: deny.id }).delete();
	await api.db("access_list_auth").where({ access_list_id: deny.id }).delete();
	const now = new Date().toISOString();
	await api.db("access_list_client").insert({
		access_list_id: deny.id,
		directive: "deny",
		address: "all",
		created_on: now,
		modified_on: now,
		meta: "{}",
	});
	await api.db("access_list").where({ id: deny.id }).update({ satisfy_any: 1 });
	const open = await makeList();
	await api.db("access_list_client").where({ access_list_id: open.id }).delete();
	await api.db("access_list_client").insert({
		access_list_id: open.id,
		directive: "allow",
		address: "all",
		created_on: now,
		modified_on: now,
		meta: "{}",
	});
	const text = await gateConfig(await makeHost([deny.id, open.id]));
	assert.deepEqual(rulesOf(text), ["deny all;"]);
	assert.match(text, AUTH_BASIC);
	assert.match(text, SATISFY_ANY);
});

it("a list with only allow all or users only renders no rule, so the password stays required", async () => {
	assert.deepEqual(rulesOf(await loneRuleHost([{ directive: "allow", address: "all" }])), []);
	const withUsers = await loneRuleHost([{ directive: "allow", address: "all" }], { users: true, satisfyAny: true });
	assert.deepEqual(rulesOf(withUsers), []);
	assert.match(withUsers, AUTH_BASIC);
	assert.deepEqual(rulesOf(await loneRuleHost([], { users: true })), []);
});

it("renders no country line for hosts whose lists have no mode", async () => {
	const list = await makeList();
	const host = await makeHost([list.id]);
	assert.doesNotMatch(await gateConfig(host), GEO_ANY);
});

// nginx -t as the real one judges the country variables: a host config that names $npmpro_geo_<id> without a map or geo
// of that name in geoip-lists.conf fails (unknown variable). Each passing test records the variables the host configs
// name and the ones geoip-lists.conf defines, "names|defines".
const strictNginx = (extra = "") =>
	api.outside.hookCommand(
		"nginx",
		`#!/bin/sh
hosts="${api.root}/data/nginx/proxy_host"
lists="${api.root}/data/npmpro/nginx/geoip-lists.conf"
${extra}
names=$(cat "$hosts"/*.conf 2>/dev/null | grep -o 'npmpro_geo_[0-9][0-9]*' | sort -u)
for v in $names; do
  if ! grep -qF "\\$$v {" "$lists"; then echo "unknown \\"$v\\" variable" >&2; exit 1; fi
done
defines=$(grep -o 'npmpro_geo_[0-9][0-9]* {' "$lists" | tr -d ' {' | sort -u)
echo "$(echo $names)|$(echo $defines)" >> "${api.root}/fake/geo-tests.log"
exit 0
`,
	);
const geoLog = () => path.join(api.root, "fake/geo-tests.log");
const geoTests = async () => {
	const text = await readFile(geoLog(), "utf8").catch(() => "");
	return text
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => line.split("|").map((part) => part.split(" ").filter(Boolean)));
};
const listsFile = () => readFile(path.join(api.root, "data/npmpro/nginx/geoip-lists.conf"), "utf8");
const variable = (id) => `npmpro_geo_${id}`;
const mapOf = (id) => new RegExp(`map "[^"]+" \\$npmpro_geo_${id} \\{`, "u");
const definesOf = (id) => new RegExp(`\\$npmpro_geo_${id} `, "u");
const gateOf = (id) => new RegExp(`\\$npmpro_geo_${id} = 0`, "u");
const FR_BLOCKED = /"1:0:FR" 0;/u;
const FR_PASSES = /"1:0:FR" 1;/u;
const OWN_DATABASE_LINE = /^geoip_country \S+dbip-country-lite\.mmdb;$/mu;
const withDatabase = async () => {
	const fixture = await readFile(path.join(import.meta.dirname, "fixtures", "GeoLite2-Country-Test.mmdb"));
	await mkdir(path.join(api.root, "data/goaccess/geoip"), { recursive: true });
	await writeFile(
		path.join(api.root, "data/goaccess/geoip/dbip-country-lite.mmdb"),
		withDatabaseType(fixture, "DBIP-Country-Lite"),
	);
};
const countryList = async (body = {}) => {
	counter += 1;
	return created(
		await admin.post(LISTS, {
			name: `countries ${counter}`,
			clients: [{ address: "10.1.0.0/16", directive: "allow" }],
			npmpro_geo_mode: "allow",
			npmpro_countries: [{ country: "DE" }],
			...body,
		}),
		"country list",
	);
};

it("writes a created list's country map at once, so a host saved with it passes nginx -t", async () => {
	await withDatabase();
	// the create writes geoip-lists.conf from every list in the database, also those earlier cases set by hand
	const list = await countryList();
	assert.match(await listsFile(), mapOf(list.id));
	await strictNginx();
	const host = await makeHost([list.id]);
	assert.equal((await row(host.id)).npmpro_nginx_online, 1);
	assert.match(await gateConfig(host), gateOf(list.id));
});

it("writes the map before the host configs when a used list gains a mode or a country", async () => {
	await withDatabase();
	const list = await makeList();
	const hosts = [await makeHost([list.id]), await makeHost([list.id])];
	await strictNginx();
	await rm(geoLog(), { force: true });
	const gained = await admin.put(`${LISTS}/${list.id}`, {
		npmpro_geo_mode: "deny",
		npmpro_countries: [{ country: "US" }],
	});
	assert.equal(gained.status, 200, gained.text);
	const added = await admin.put(`${LISTS}/${list.id}`, { npmpro_countries: [{ country: "US" }, { country: "FR" }] });
	assert.equal(added.status, 200, added.text);
	for (const host of hosts) {
		assert.equal((await row(host.id)).npmpro_nginx_online, 1);
		assert.match(await gateConfig(host), gateOf(list.id));
	}
	// one batch test per save, each with the new gates and their map together
	const tests = await geoTests();
	assert.equal(tests.length, 2);
	for (const [names, defines] of tests) {
		assert.ok(names.includes(variable(list.id)), names.join(" "));
		assert.ok(defines.includes(variable(list.id)), defines.join(" "));
	}
	assert.match(await listsFile(), FR_BLOCKED);
	// a single host save after it finds the map as well
	const saved = await admin.put(`${HOSTS}/${hosts[0].id}`, { forward_port: 81 });
	assert.equal(saved.status, 200, saved.text);
	assert.equal((await row(hosts[0].id)).npmpro_nginx_online, 1);
});

it("keeps a passing variable while a list turned off is checked host by host, then drops it", async () => {
	await withDatabase();
	const list = await countryList({ npmpro_geo_mode: "deny" });
	const good = await makeHost([list.id]);
	const bad = await makeHost([list.id]);
	await api.db("proxy_host").where({ id: bad.id }).update({ advanced_config: "# BADHOST" });
	await strictNginx(
		`if grep -rq BADHOST --include='*.conf' "$hosts"; then echo "BADHOST is not valid" >&2; exit 1; fi`,
	);
	const off = await admin.put(`${LISTS}/${list.id}`, { npmpro_geo_mode: "off" });
	assert.equal(off.status, 200, off.text);
	// the batch failed on the broken host and the hosts were checked one by one from their old configs: the good host
	// passed although the old config of the broken one still named the variable
	assert.equal((await row(good.id)).npmpro_nginx_online, 1);
	assert.equal((await row(bad.id)).npmpro_nginx_online, 0);
	assert.doesNotMatch(await gateConfig(good), gateOf(list.id));
	assert.doesNotMatch(await listsFile(), definesOf(list.id));
});

it("rewrites the host configs without the gate before the deleted list's map leaves geoip-lists.conf", async () => {
	await withDatabase();
	const list = await countryList();
	const hosts = [await makeHost([list.id]), await makeHost([list.id])];
	await strictNginx();
	await rm(geoLog(), { force: true });
	assert.equal((await admin.delete(`${LISTS}/${list.id}`)).status, 200);
	const tests = await geoTests();
	assert.equal(tests.length, 1);
	const [[names, defines]] = tests;
	assert.ok(!names.includes(variable(list.id)), names.join(" "));
	assert.ok(defines.includes(variable(list.id)), defines.join(" "));
	assert.doesNotMatch(await listsFile(), definesOf(list.id));
	for (const host of hosts) assert.equal((await row(host.id)).npmpro_nginx_online, 1);
});

it("a host save writes geoip-lists.conf again when the file lacks a variable its gates name", async () => {
	await withDatabase();
	const list = await countryList();
	// a restore or a hand edit left the file behind the database: only the private geo
	await writeFile(
		path.join(api.root, "data/npmpro/nginx/geoip-lists.conf"),
		"geo $npmpro_geo_private {\n  default 0;\n}\n",
	);
	await strictNginx();
	const host = await makeHost([list.id]);
	assert.equal((await row(host.id)).npmpro_nginx_online, 1);
	assert.match(await listsFile(), mapOf(list.id));
	// in sync: the next save leaves the file alone
	const synced = await listsFile();
	assert.equal((await admin.put(`${HOSTS}/${host.id}`, { forward_port: 82 })).status, 200);
	assert.equal(await listsFile(), synced);
});

it("drops a deleted list's map also when the host configs could not be written", async () => {
	await withDatabase();
	const list = await countryList();
	const host = await makeHost([list.id]);
	await strictNginx();
	const { default: nginxModule } = await import("../internal/nginx.js");
	const original = nginxModule.configureMany;
	nginxModule.configureMany = () => Promise.reject(new Error("disk full"));
	try {
		assert.equal((await admin.delete(`${LISTS}/${list.id}`)).status, 500);
	} finally {
		nginxModule.configureMany = original;
	}
	// the old config still names the variable: it lets everyone pass now, the list's own map is gone
	const text = await listsFile();
	assert.doesNotMatch(text, mapOf(list.id));
	assert.match(text, new RegExp(`geo \\$npmpro_geo_${list.id} \\{\\n {2}default 1;`, "u"));
	assert.match(await gateConfig(host), gateOf(list.id));
	// and nginx -t still passes with it: the host stays online on its next save
	assert.equal((await admin.put(`${HOSTS}/${host.id}`, { forward_port: 83 })).status, 200);
	assert.equal((await row(host.id)).npmpro_nginx_online, 1);
});

it("a list or host save picks up an own geoip_country added or removed since the last sync", async () => {
	await withDatabase();
	const geoipConf = () => readFile(path.join(api.root, "data/npmpro/nginx/geoip.conf"), "utf8");
	const own = path.join(api.root, "data/custom_nginx/http_top.conf");
	await mkdir(path.dirname(own), { recursive: true });
	const list = await countryList({ npmpro_countries: [{ country: "FR" }] });
	const host = await makeHost([list.id]);
	assert.match(await geoipConf(), OWN_DATABASE_LINE);
	// nginx refuses a second geoip_country, as the real one does with an own line in http_top.conf
	await strictNginx(
		`if grep -q '^geoip_country' "${api.root}/data/npmpro/nginx/geoip.conf" && grep -qs geoip_country "${own}"; then echo 'nginx: [emerg] "geoip_country" directive is duplicate in ${own}:1' >&2; exit 1; fi`,
	);
	try {
		await writeFile(own, "geoip_country /etc/own/GeoIP.dat;\n");
		const added = await admin.put(`${LISTS}/${list.id}`, { name: `own directive ${list.id}` });
		assert.equal(added.status, 200, added.text);
		assert.doesNotMatch(await geoipConf(), OWN_DATABASE_LINE);
		assert.equal((await admin.get(`${LISTS}/geoip`)).body.custom_directive, true);
		assert.equal((await row(host.id)).npmpro_nginx_online, 1);
		// a host save alone switches both ways too
		await rm(own);
		assert.equal((await admin.put(`${HOSTS}/${host.id}`, { forward_port: 84 })).status, 200);
		assert.match(await geoipConf(), OWN_DATABASE_LINE);
		await writeFile(own, "geoip_country /etc/own/GeoIP.dat;\n");
		assert.equal((await admin.put(`${HOSTS}/${host.id}`, { forward_port: 85 })).status, 200);
		assert.doesNotMatch(await geoipConf(), OWN_DATABASE_LINE);
		assert.equal((await row(host.id)).npmpro_nginx_online, 1);

		await rm(own);
		const removed = await admin.put(`${LISTS}/${list.id}`, { name: `database again ${list.id}` });
		assert.equal(removed.status, 200, removed.text);
		// NPMpro's own line is back, so $geoip_country_code is filled and the allow map lets an FR visitor pass
		assert.match(await geoipConf(), OWN_DATABASE_LINE);
		assert.match(await listsFile(), FR_PASSES);
		assert.equal((await row(host.id)).npmpro_nginx_online, 1);
	} finally {
		await rm(own, { force: true });
	}
});
