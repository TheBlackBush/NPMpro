import assert from "node:assert/strict";
import { rename } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { startApi } from "./support/api.js";
import { certbotFails, certbotSucceeds, makeCertificate } from "./support/certbot.js";
import { countRows, created, fileExists, reloads } from "./support/hosts.js";

// The order of the steps of a host save is behaviour: these tests were written before the host services moved into
// internal/host-service.js and must pass unchanged after each move.
let counter = 0;
let api;
let admin;
let credentialId;
let pair;
const next = () => {
	counter += 1;
	return counter;
};
const TYPES = [
	{
		label: "proxy host",
		url: "/nginx/proxy-hosts",
		dir: "data/nginx/proxy_host",
		table: "proxy_host",
		auditType: "proxy-host",
		permission: "proxy_hosts",
		edit: { forward_host: "10.0.0.7" },
		make: () => ({
			domain_names: [`po${next()}.example.com`],
			forward_scheme: "http",
			forward_host: "10.0.0.1",
			forward_port: 80,
		}),
	},
	{
		label: "redirection host",
		url: "/nginx/redirection-hosts",
		dir: "data/nginx/redirection_host",
		table: "redirection_host",
		auditType: "redirection-host",
		permission: "redirection_hosts",
		edit: { forward_domain_name: "other.example.org" },
		make: () => ({
			domain_names: [`ro${next()}.example.com`],
			forward_domain_name: "target.example.org",
			forward_scheme: "https",
			forward_http_code: 301,
		}),
	},
	{
		label: "dead host",
		url: "/nginx/dead-hosts",
		dir: "data/nginx/dead_host",
		table: "dead_host",
		auditType: "dead-host",
		permission: "dead_hosts",
		edit: { ssl_forced: false },
		make: () => ({ domain_names: [`do${next()}.example.com`] }),
	},
	{
		label: "stream",
		url: "/nginx/streams",
		dir: "data/nginx/stream",
		table: "stream",
		auditType: "stream",
		permission: "streams",
		edit: { forwarding_host: "10.0.0.7" },
		make: () => ({
			incoming_port: String(9500 + next()),
			forwarding_host: "10.0.0.2",
			forwarding_port: "22",
			tcp_forwarding: true,
		}),
	},
];
const newCertificate = (type) =>
	type.label === "stream"
		? {
				certificate_id: "new",
				domain_names: [`scert${next()}.example.com`],
				npmpro_dns_challenge: true,
				npmpro_dns_provider: "cloudflare",
				npmpro_dns_credential_id: credentialId,
			}
		: { certificate_id: "new" };
const auditRows = (type, id, action) =>
	api.db("audit_log").where({ object_type: type.auditType, object_id: id, action });
const withoutFolder = async (dir, run) => {
	const folder = path.join(api.root, dir);
	await rename(folder, `${folder}.off`);
	try {
		return await run();
	} finally {
		await rename(`${folder}.off`, folder);
	}
};
const certbotCalls = async () => (await api.outside.calls()).filter((line) => line.startsWith("certbot "));

before(async () => {
	api = await startApi({ env: { ACME_SERVER: "https://acme.example.test/directory" } });
	admin = await api.admin();
	pair = await makeCertificate(path.join(api.root, "fake"), "order.example.com");
	const credential = await admin.post("/nginx/dns-credentials", {
		name: "Order",
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: "order-token" }],
	});
	assert.equal(credential.status, 201, credential.text);
	credentialId = credential.body.id;
});
after(() => api?.stop());
beforeEach(() => api.outside.clearCalls());

for (const type of TYPES) {
	it(`${type.label}: a failing configure on create still leaves the row and the audit entry`, async () => {
		const rows = await countRows(api, type.table);
		const answer = await withoutFolder(type.dir, () => admin.post(type.url, type.make()));
		assert.equal(answer.status, 500, answer.text);
		assert.equal(await countRows(api, type.table), rows + 1);
		const row = await api.db(type.table).orderBy("id", "desc").first();
		assert.equal((await auditRows(type, row.id, "created")).length, 1);
	});

	it(`${type.label}: a failing configure on update and enable still logs`, async () => {
		const host = await created(await admin.post(type.url, type.make()), "create");
		const updated = await withoutFolder(type.dir, () => admin.put(`${type.url}/${host.id}`, type.edit));
		assert.equal(updated.status, 500, updated.text);
		assert.equal((await auditRows(type, host.id, "updated")).length, 1);
		assert.equal((await admin.post(`${type.url}/${host.id}/disable`)).status, 200);
		const enabled = await withoutFolder(type.dir, () => admin.post(`${type.url}/${host.id}/enable`));
		assert.equal(enabled.status, 500, enabled.text);
		assert.equal((await auditRows(type, host.id, "enabled")).length, 1);
		assert.equal((await api.db(type.table).where({ id: host.id }).first()).enabled, 1);
	});

	it(`${type.label}: a disabled host gets no config and no reload on update`, async () => {
		const host = await created(await admin.post(type.url, type.make()), "create");
		assert.equal((await admin.post(`${type.url}/${host.id}/disable`)).status, 200);
		const file = `${type.dir}/${host.id}.conf`;
		assert.equal(await fileExists(api, file), false);
		const reloadsBefore = reloads(api);
		const answer = await admin.put(`${type.url}/${host.id}`, type.edit);
		assert.equal(answer.status, 200, answer.text);
		assert.equal(answer.body.enabled, false);
		assert.equal(await fileExists(api, file), false);
		assert.equal(reloads(api), reloadsBefore);
		assert.equal((await auditRows(type, host.id, "updated")).length, 1);
	});

	it(`${type.label}: the permission is checked before the row and the free check`, async () => {
		const taken = await created(await admin.post(type.url, type.make()), "create");
		const viewer = await api.limited({
			visibility: "all",
			access_lists: "view",
			certificates: "view",
			[type.permission]: "view",
		});
		const again = type.make();
		if (again.domain_names) again.domain_names = taken.domain_names;
		else again.incoming_port = taken.incoming_port;
		assert.equal((await viewer.post(type.url, again)).status, 403);
	});

	it(`${type.label}: a refused save requests no certificate`, async () => {
		const taken = await created(await admin.post(type.url, type.make()), "create");
		const certificates = await countRows(api, "certificate");
		const clash = { ...type.make(), ...newCertificate(type) };
		if (type.label === "stream") clash.incoming_port = taken.incoming_port;
		else clash.domain_names = taken.domain_names;
		const answer = await admin.post(type.url, clash);
		assert.equal(answer.status, 400, answer.text);
		assert.deepEqual(await certbotCalls(), []);
		assert.equal(await countRows(api, "certificate"), certificates);
	});

	it(`${type.label}: a failed certificate on update leaves the stored row as it was`, async () => {
		const host = await created(await admin.post(type.url, type.make()), "create");
		const stored = await api.db(type.table).where({ id: host.id }).first();
		await certbotFails(api, "no certificate today");
		const answer = await admin.put(`${type.url}/${host.id}`, newCertificate(type));
		assert.equal(answer.status >= 400, true, answer.text);
		assert.deepEqual(await api.db(type.table).where({ id: host.id }).first(), stored);
		assert.equal((await auditRows(type, host.id, "updated")).length, 0);
	});

	it(`${type.label}: a new certificate on update is stored with the SSL fields`, async () => {
		const host = await created(await admin.post(type.url, type.make()), "create");
		await certbotSucceeds(api, pair);
		const answer = await admin.put(`${type.url}/${host.id}`, {
			...newCertificate(type),
			...(type.label === "stream" ? {} : { ssl_forced: true }),
		});
		assert.equal(answer.status, 200, answer.text);
		assert.ok(answer.body.certificate_id > 0);
		if (type.label !== "stream") assert.equal(answer.body.ssl_forced, true);
	});
}

it("proxy host: an access list that does not exist is refused before a new certificate", async () => {
	const proxy = TYPES[0];
	const certificates = await countRows(api, "certificate");
	const answer = await admin.post(proxy.url, {
		...proxy.make(),
		certificate_id: "new",
		npmpro_access_list_type: "custom",
		npmpro_access_list_ids: [99999],
	});
	assert.equal(answer.status, 400, answer.text);
	assert.deepEqual(await certbotCalls(), []);
	assert.equal(await countRows(api, "certificate"), certificates);
});

it("the certificate check comes before the row on update, except for streams", async () => {
	for (const type of TYPES) {
		const answer = await admin.put(`${type.url}/77777`, { certificate_id: 88888 });
		assert.equal(answer.status, 404, type.label);
		assert.equal(answer.body.error.message, `Not Found - ${type.label === "stream" ? 77777 : 88888}`);
	}
});

it("stream: the port check runs only when the listener changes", async () => {
	const stream = TYPES[3];
	const first = await created(await admin.post(stream.url, stream.make()), "create");
	const second = await created(await admin.post(stream.url, stream.make()), "create");
	await api.db("stream").where({ id: second.id }).update({ incoming_port: first.incoming_port });
	assert.equal((await admin.put(`${stream.url}/${second.id}`, { forwarding_host: "10.0.0.3" })).status, 200);
	const moved = await admin.put(`${stream.url}/${second.id}`, { udp_forwarding: true });
	assert.equal(moved.status, 400, moved.text);
	assert.match(moved.body.error.message, /already uses the incoming port/u);
});
