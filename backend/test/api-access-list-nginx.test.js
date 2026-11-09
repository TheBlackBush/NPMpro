import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { startApi } from "./support/api.js";
import { created, fileExists, reloads } from "./support/hosts.js";

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
