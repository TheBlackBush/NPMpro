import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { addCertificate, countRows, created } from "./support/hosts.js";

// A save whose nginx reload fails twice (the cause is outside the saved host): the row is kept, the answer is a public
// 500 "Saved, but nginx could not reload" with the nginx text as output and the saved row's id, so the window can
// switch to edit mode and the next save updates instead of creating a second host.

let api;
let admin;
before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

const failEveryReload = (text) => {
	api.outside.control.check = () => text;
};
const passReloads = () => {
	api.outside.control.check = null;
};

const TYPES = [
	{
		url: "/nginx/proxy-hosts",
		table: "proxy_host",
		body: (n) => ({
			domain_names: [`reload${n}.example.com`],
			forward_scheme: "http",
			forward_host: "10.0.9.1",
			forward_port: 80,
		}),
		edit: { forward_port: 81 },
	},
	{
		url: "/nginx/redirection-hosts",
		table: "redirection_host",
		body: (n) => ({
			domain_names: [`reload-r${n}.example.com`],
			forward_scheme: "https",
			forward_domain_name: "target.example.org",
			forward_http_code: 301,
		}),
		edit: { forward_http_code: 302 },
	},
	{
		url: "/nginx/dead-hosts",
		table: "dead_host",
		body: (n) => ({ domain_names: [`reload-d${n}.example.com`] }),
		edit: { ssl_forced: false },
	},
	{
		url: "/nginx/streams",
		table: "stream",
		body: (n) => ({
			incoming_port: String(19700 + n),
			forwarding_host: "10.0.9.2",
			forwarding_port: "22",
			tcp_forwarding: true,
		}),
		edit: { forwarding_port: "23" },
	},
];

let counter = 0;
for (const type of TYPES) {
	it(`${type.table}: a create whose reload fails keeps the row and names it, the next save updates it`, async () => {
		counter += 1;
		const rows = await countRows(api, type.table);
		failEveryReload("nginx: [emerg] bind() to 0.0.0.0:9999 failed (98: Address in use)");
		const answer = await admin.post(type.url, type.body(counter));
		passReloads();
		assert.equal(answer.status, 500, answer.text);
		assert.equal(answer.body.error.message_i18n, "error.nginx-reload-after-save");
		assert.match(answer.body.error.message, /^Saved, but nginx could not reload: nginx: \[emerg\] bind\(\)/u);
		assert.match(answer.body.error.output, /Address in use/u);
		assert.equal(await countRows(api, type.table), rows + 1);
		const id = answer.body.error.saved_id;
		assert.ok(Number.isInteger(id));
		assert.ok(await api.db(type.table).where({ id }).first());
		const again = await admin.put(`${type.url}/${id}`, type.edit);
		assert.equal(again.status, 200, again.text);
		assert.equal(await countRows(api, type.table), rows + 1);
	});
}

it("names the certificate of the saved host, so a new certificate is not requested twice", async () => {
	const certificate = await addCertificate(api, { domain: "reload-cert.example.com" });
	failEveryReload("nginx: [emerg] broken include");
	const answer = await admin.post("/nginx/proxy-hosts", {
		domain_names: ["reload-cert.example.com"],
		forward_scheme: "http",
		forward_host: "10.0.9.3",
		forward_port: 80,
		certificate_id: certificate,
	});
	passReloads();
	assert.equal(answer.status, 500, answer.text);
	assert.equal(answer.body.error.saved_certificate_id, certificate);
});

it("a disable, enable or delete whose reload fails keeps the change and says so, not that it saved", async () => {
	const host = await created(
		await admin.post("/nginx/dead-hosts", { domain_names: ["reload-off.example.com"] }),
		"create",
	);
	const changed = (answer) => {
		assert.equal(answer.status, 500, answer.text);
		assert.equal(answer.body.error.message_i18n, "error.nginx-reload-after-change");
		assert.match(answer.body.error.message, /^Changed, but nginx could not reload: nginx: \[emerg\] other host/u);
		assert.match(answer.body.error.output, /other host broken/u);
	};
	api.outside.control.failNext = "nginx: [emerg] other host broken";
	const disabled = await admin.post(`/nginx/dead-hosts/${host.id}/disable`);
	changed(disabled);
	assert.equal(disabled.body.error.saved_id, host.id);
	assert.equal((await api.db("dead_host").where({ id: host.id }).first()).enabled, 0);
	failEveryReload("nginx: [emerg] other host broken");
	const enabled = await admin.post(`/nginx/dead-hosts/${host.id}/enable`);
	passReloads();
	changed(enabled);
	assert.equal((await api.db("dead_host").where({ id: host.id }).first()).enabled, 1);
	api.outside.control.failNext = "nginx: [emerg] other host broken";
	const deleted = await admin.delete(`/nginx/dead-hosts/${host.id}`);
	changed(deleted);
	assert.equal("saved_id" in deleted.body.error, false);
	assert.equal(await api.db("dead_host").where({ id: host.id }).first(), undefined);
});

it("an access list delete whose reload fails keeps the delete and says so", async () => {
	const list = await created(
		await admin.post("/nginx/access-lists", {
			name: "reload-gone",
			items: [{ username: "g", password: "reload-password-2" }],
		}),
		"create list",
	);
	api.outside.control.failNext = "nginx: [emerg] other host broken";
	const deleted = await admin.delete(`/nginx/access-lists/${list.id}`);
	assert.equal(deleted.status, 500, deleted.text);
	assert.equal(deleted.body.error.message_i18n, "error.nginx-reload-after-change");
	assert.equal(await api.db("access_list").where({ id: list.id }).first(), undefined);
});

it("the message names nginx's first [emerg] line, not a warning before it", async () => {
	failEveryReload('nginx: [warn] duplicate MIME type "text/html"\nnginx: [emerg] host not found in upstream "x"');
	const answer = await admin.post("/nginx/dead-hosts", { domain_names: ["reload-warn.example.com"] });
	passReloads();
	assert.equal(answer.status, 500, answer.text);
	assert.equal(
		answer.body.error.message,
		'Saved, but nginx could not reload: nginx: [emerg] host not found in upstream "x"',
	);
	assert.match(answer.body.error.output, /duplicate MIME type/u);
});

it("an access list update whose reload fails keeps the list and names it", async () => {
	const list = await created(
		await admin.post("/nginx/access-lists", {
			name: "reload-list",
			items: [{ username: "r", password: "reload-password-1" }],
		}),
		"create list",
	);
	await created(
		await admin.post("/nginx/proxy-hosts", {
			domain_names: ["reload-acl.example.com"],
			forward_scheme: "http",
			forward_host: "10.0.9.4",
			forward_port: 80,
			npmpro_access_list_type: "custom",
			npmpro_access_list_ids: [list.id],
		}),
		"create host",
	);
	failEveryReload("nginx: [emerg] other host broken");
	const answer = await admin.put(`/nginx/access-lists/${list.id}`, { name: "reload-list-2" });
	passReloads();
	assert.equal(answer.status, 500, answer.text);
	assert.equal(answer.body.error.saved_id, list.id);
	assert.equal((await api.db("access_list").where({ id: list.id }).first()).name, "reload-list-2");
});

it("a first reload failure alone still answers 201 with the nginx error on the row (unchanged)", async () => {
	api.outside.control.failNext = "nginx: [emerg] unknown directive";
	const answer = await admin.post("/nginx/dead-hosts", { domain_names: ["reload-once.example.com"] });
	assert.equal(answer.status, 201, answer.text);
	assert.equal(answer.body.npmpro_nginx_online, false);
});
