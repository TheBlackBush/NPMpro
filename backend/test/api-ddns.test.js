import assert from "node:assert/strict";
import { after, afterEach, before, it } from "node:test";
import { startApi } from "./support/api.js";

const RECORDS = "/nginx/ddns-records";
const CF = "https://api.cloudflare.com";
const TOKEN = "cf-token-SECRET-ddns-1234567890";
const PUBLIC_IP = "81.2.69.160";
const OLD_IP = "81.2.69.100";
const SECTIONS = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"];
const ZONE_LOOKUP = /^\/client\/v4\/zones\?name=/u;
const RECORD_LOOKUP = /^\/client\/v4\/zones\/zone1\/dns_records\?/u;
const STARS = /\*\*\*/u;
const json = { headers: { "content-type": "application/json" } };

let api;
let admin;
let credentials = 0;
const echo = { status: 200, body: `${PUBLIC_IP}\n` };
const cloudflare = { content: OLD_IP, patches: [], zoneLookups: 0, failWith: null };

const makeCredential = async (session = admin, body = {}) => {
	credentials += 1;
	const done = await session.post("/nginx/dns-credentials", {
		name: `DDNS credential ${credentials}`,
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: TOKEN }],
		...body,
	});
	if (done.status !== 201) throw new Error(`credential create answered ${done.status}: ${done.text}`);
	return done.body;
};
const withDomain = async (session = admin, domain = "example.com") => {
	const made = await makeCredential(session);
	const added = await session.post("/nginx/dns-domains", { dns_credential_id: made.id, names: [domain] });
	if (added.status !== 201) throw new Error(`domain create answered ${added.status}: ${added.text}`);
	return made;
};
const add = (body, session = admin) => session.post(RECORDS, body);
const addOk = async (body, session = admin) => {
	const done = await add(body, session);
	// a setup step, not a test: a failed create stops the calling test with the answer
	if (done.status !== 201) throw new Error(`record create answered ${done.status}: ${done.text}`);
	return done.body;
};
const auditRows = (action) => api.db("audit_log").where({ object_type: "ddns-record", action }).orderBy("id", "desc");

const mockEchoServices = () => {
	for (const host of ["ip1.test", "ip2.test"]) {
		api.outside.http
			.get(`https://${host}`)
			.intercept({ path: "/", method: "GET" })
			.reply(() => ({ statusCode: echo.status, data: echo.body }))
			.persist();
	}
};

const mockCloudflare = () => {
	const pool = api.outside.http.get(CF);
	pool.intercept({ path: ZONE_LOOKUP, method: "GET" })
		.reply(() => {
			cloudflare.zoneLookups += 1;
			return cloudflare.failWith
				? { statusCode: 403, data: cloudflare.failWith, responseOptions: json }
				: { statusCode: 200, data: { success: true, result: [{ id: "zone1" }] }, responseOptions: json };
		})
		.persist();
	pool.intercept({ path: RECORD_LOOKUP, method: "GET" })
		.reply(() => ({
			statusCode: 200,
			data: {
				success: true,
				result: [{ id: "rec1", content: cloudflare.content, ttl: 1, proxied: false }],
			},
			responseOptions: json,
		}))
		.persist();
	pool.intercept({ path: "/client/v4/zones/zone1/dns_records/rec1", method: "PATCH" })
		.reply((options) => {
			cloudflare.patches.push(JSON.parse(options.body));
			return { statusCode: 200, data: { success: true, result: { id: "rec1" } }, responseOptions: json };
		})
		.persist();
};

before(async () => {
	api = await startApi({ env: { DDNS_IPV4_SERVICES: "https://ip1.test https://ip2.test" } });
	admin = await api.admin();
	api.outside.dns.set("ip1.test", "198.51.100.50");
	api.outside.dns.set("ip2.test", "198.51.100.51");
	api.outside.dns.set("api.cloudflare.com", "198.51.100.20");
	mockEchoServices();
	mockCloudflare();
});
afterEach(async () => {
	cloudflare.content = OLD_IP;
	cloudflare.patches.length = 0;
	cloudflare.failWith = null;
	echo.status = 200;
	echo.body = `${PUBLIC_IP}\n`;
	await api.db("npmpro_ddns_history").del();
	await api.db("npmpro_ddns_record").del();
	await api.db("npmpro_dns_domain").del();
});
after(() => api?.stop());

it("creates a record in the zone a domain of the credential covers, audited without a value", async () => {
	const made = await withDomain();
	const record = await addOk({ name: "Home.Example.COM.", dns_credential_id: made.id });
	assert.equal(record.name, "home.example.com");
	assert.equal(record.zone, "example.com");
	assert.equal(record.provider, "cloudflare");
	assert.equal(record.kind, "address");
	assert.equal(record.ip_version, "ipv4");
	assert.equal(record.state, "pending");
	assert.equal(record.enabled, true);
	assert.equal(record.error_i18n, null);
	assert.equal("secret" in record, false);
	const [entry] = await auditRows("created");
	assert.equal(entry.object_id, record.id);
	const meta = JSON.parse(entry.meta);
	assert.equal(meta.name, "home.example.com");
	assert.equal(meta.credential_name, made.name);
	assert.equal(meta.dns_credential_id, made.id);
	assert.equal(entry.meta.includes(TOKEN), false);
	assert.equal(JSON.stringify(record).includes(TOKEN), false);
});

it("asks for a zone when no domain of the credential covers the name, then takes a typed one", async () => {
	const made = await makeCredential();
	const refused = await add({ name: "home.example.org", dns_credential_id: made.id });
	assert.equal(refused.status, 400, refused.text);
	assert.equal(refused.body.error.message_i18n, "error.ddns-no-zone");
	assert.equal(refused.body.error.message_values.domain, "example.org");
	assert.equal(refused.body.error.message_values.credential, made.name);
	const wrong = await add({ name: "home.example.org", dns_credential_id: made.id, zone: "other.net" });
	assert.equal(wrong.status, 400);
	assert.equal(wrong.body.error.message_i18n, "error.ddns-zone-mismatch");
	const typed = await add({ name: "home.example.org", dns_credential_id: made.id, zone: "Example.org" });
	assert.equal(typed.status, 201, typed.text);
	assert.equal(typed.body.zone, "example.org");
});

it("refuses a credential whose provider has no updater, an unknown credential and a provider that does not match", async () => {
	const acme = await makeCredential(admin, {
		provider: "acmedns",
		fields: undefined,
		ini: "dns_acmedns_api_url = https://auth.acme-dns.io\n",
	});
	const refused = await add({ name: "home.example.com", dns_credential_id: acme.id, zone: "example.com" });
	assert.equal(refused.status, 400, refused.text);
	assert.equal(refused.body.error.message_i18n, "error.ddns-no-updater");
	assert.equal((await add({ name: "home.example.com", dns_credential_id: 99999 })).status, 404);
	const made = await withDomain();
	const mismatch = await add({ name: "home.example.com", dns_credential_id: made.id, provider: "gandi" });
	assert.equal(mismatch.status, 400);
	assert.equal(mismatch.body.error.message_i18n, "error.ddns-provider-mismatch");
	assert.equal(
		(await add({ name: "home.example.com", dns_credential_id: made.id, provider: "cloudflare" })).status,
		201,
	);
});

it("refuses a name that exists, in any spelling, and a name that is no host name", async () => {
	const made = await withDomain();
	await addOk({ name: "taken.example.com", dns_credential_id: made.id });
	const again = await add({ name: "TAKEN.example.com.", dns_credential_id: made.id });
	assert.equal(again.status, 400);
	assert.equal(again.body.error.message_i18n, "error.ddns-name-taken");
	assert.equal(again.body.error.message_values.name, "taken.example.com");
	for (const name of ["bad/name.example.com", "localhost", "1.2.3.4", "*.*.example.com"]) {
		const refused = await add({ name, dns_credential_id: made.id, zone: "example.com" });
		assert.equal(refused.status, 400, name);
		assert.equal(refused.body.error.message_i18n, "error.ddns-name-invalid", name);
	}
});

it("accepts a wildcard where the provider allows it and refuses it where it does not", async () => {
	const made = await withDomain();
	const wild = await addOk({ name: "*.Example.com", dns_credential_id: made.id });
	assert.equal(wild.name, "*.example.com");
	assert.equal(wild.zone, "example.com");
	const hetzner = await makeCredential(admin, {
		provider: "hetzner-cloud",
		fields: [{ key: "dns_hetzner_cloud_api_token", value: "hetzner-secret-token-12345" }],
	});
	const refused = await add({ name: "*.example.net", dns_credential_id: hetzner.id, zone: "example.net" });
	assert.equal(refused.status, 400, refused.text);
	assert.equal(refused.body.error.message_i18n, "error.ddns-wildcard-unsupported");
	assert.equal(refused.body.error.message_values.provider, "Hetzner Cloud");
	assert.equal(
		(await add({ name: "www.example.net", dns_credential_id: hetzner.id, zone: "example.net" })).status,
		201,
	);
});

it("keeps the rules of the two kinds: an alias needs a target and no IP settings, an address takes no target", async () => {
	const made = await withDomain();
	const alias = await addOk({
		name: "www.example.com",
		dns_credential_id: made.id,
		kind: "alias",
		target: "LB.Example.NET.",
	});
	assert.equal(alias.kind, "alias");
	assert.equal(alias.target, "lb.example.net");
	assert.equal(alias.ipv6_suffix, null);
	// an alias follows no address: it answers no IP version and takes null or none on a new save
	assert.equal(alias.ip_version, null);
	const copied = await add({
		name: "copy.example.com",
		dns_credential_id: made.id,
		kind: "alias",
		target: "lb.example.net",
		ip_version: null,
		ipv6_suffix: null,
	});
	assert.equal(copied.status, 201, copied.text);
	assert.equal(copied.body.ip_version, null);
	assert.equal((await admin.put(`${RECORDS}/${copied.body.id}`, { ip_version: null, ttl: 120 })).status, 200);
	const refuse = async (body, key) => {
		const done = await add({ dns_credential_id: made.id, ...body });
		assert.equal(done.status, 400, `${done.text} ${JSON.stringify(body)}`);
		assert.equal(done.body.error.message_i18n, key, JSON.stringify(body));
	};
	await refuse({ name: "a1.example.com", kind: "alias" }, undefined);
	await refuse({ name: "a2.example.com", kind: "alias", target: "a2.example.com" }, "error.ddns-alias-self");
	await refuse({ name: "a3.example.com", kind: "alias", target: "*.example.net" }, "error.ddns-target-invalid");
	await refuse(
		{ name: "a4.example.com", kind: "alias", target: "x.example.net", ip_version: "ipv6" },
		"error.ddns-alias-no-ip",
	);
	await refuse({ name: "a5.example.com", kind: "alias", target: "x.example.net", ipv6_suffix: "::1" }, undefined);
	await refuse({ name: "a6.example.com", target: "x.example.net" }, "error.ddns-address-no-target");
	// a CNAME cannot sit at the zone apex
	await refuse({ name: "example.com", kind: "alias", target: "x.example.net" }, "error.ddns-alias-apex");
	const apex = await addOk({ name: "example.com", dns_credential_id: made.id });
	const toApexAlias = await admin.put(`${RECORDS}/${apex.id}`, { kind: "alias", target: "x.example.net" });
	assert.equal(toApexAlias.status, 400, toApexAlias.text);
	assert.equal(toApexAlias.body.error.message_i18n, "error.ddns-alias-apex");
	// a stored alias passes a save that keeps its values
	const kept = await admin.put(`${RECORDS}/${alias.id}`, {
		kind: "alias",
		target: "lb.example.net",
		ip_version: "ipv4",
	});
	assert.equal(kept.status, 200, kept.text);
});

it("checks the IP version, the IPv6 suffix, the TTL and the kind at the schema and in the service", async () => {
	const made = await withDomain();
	const refuse = async (body) => {
		const done = await add({ name: "v.example.com", dns_credential_id: made.id, ...body });
		assert.equal(done.status, 400, `${done.text} ${JSON.stringify(body)}`);
		return done.body.error.message_i18n;
	};
	for (const body of [
		{ ip_version: "ipv5" },
		{ kind: "cname" },
		{ ttl: 29 },
		{ ttl: 90_000 },
		{ enabled: "maybe" },
		{ extra: 1 },
	]) {
		await refuse(body);
	}
	assert.equal(await refuse({ ipv6_suffix: "::1" }), "error.ddns-suffix-needs-ipv6");
	// each provider has its own lowest TTL (Cloudflare 60)
	const low = await add({ name: "v.example.com", dns_credential_id: made.id, ttl: 30 });
	assert.equal(low.body.error.message_i18n, "error.ddns-ttl-min");
	assert.deepEqual(low.body.error.message_values, { min: 60, provider: "Cloudflare" });
	assert.equal(await refuse({ ip_version: "ipv6", ipv6_suffix: "not-a-suffix" }), "error.ddns-suffix-invalid");
	assert.equal(await refuse({ ip_version: "both", ipv6_suffix: "::" }), "error.ddns-suffix-invalid");
	const good = await addOk({
		name: "v6.example.com",
		dns_credential_id: made.id,
		ip_version: "both",
		ipv6_suffix: "::a:b",
		ttl: 300,
	});
	assert.equal(good.ipv6_suffix, "::a:b");
	assert.equal(good.ttl, 300);
	const disabled = await addOk({ name: "off.example.com", dns_credential_id: made.id, enabled: false });
	assert.equal(disabled.state, "disabled");
});

it("changes a record: a new name clears what was learned, turning it off and on sets the state, an unchanged value is kept", async () => {
	const made = await withDomain();
	const record = await addOk({ name: "old.example.com", dns_credential_id: made.id });
	await api
		.db("npmpro_ddns_record")
		.where({ id: record.id })
		.update({
			state: "failed",
			failures: 3,
			error: "boom",
			last_ipv4: OLD_IP,
			meta: JSON.stringify({ zone_id: "zone1", record_id: "rec1", error_i18n: "error.ddns-multi-value" }),
		});
	const renamed = await admin.put(`${RECORDS}/${record.id}`, { name: "New.Example.com" });
	assert.equal(renamed.status, 200, renamed.text);
	assert.equal(renamed.body.name, "new.example.com");
	assert.equal(renamed.body.state, "pending");
	assert.equal(renamed.body.failures, 0);
	assert.equal(renamed.body.error, null);
	assert.equal(renamed.body.error_i18n, null);
	assert.equal(renamed.body.last_ipv4, null);
	assert.equal((await api.db("npmpro_ddns_record").where({ id: record.id }).first()).meta, null);
	const off = await admin.put(`${RECORDS}/${record.id}`, { enabled: false });
	assert.equal(off.body.state, "disabled");
	assert.equal((await auditRows("disabled")).length, 1);
	const on = await admin.put(`${RECORDS}/${record.id}`, { enabled: true });
	assert.equal(on.body.state, "pending");
	assert.equal((await auditRows("enabled")).length, 1);
	// the stored name passes again (also as stored text that would not pass a new check)
	await api.db("npmpro_ddns_record").where({ id: record.id }).update({ name: "Legacy_Name.example.com" });
	const kept = await admin.put(`${RECORDS}/${record.id}`, { name: "Legacy_Name.example.com", ttl: 600 });
	assert.equal(kept.status, 200, kept.text);
	assert.equal(kept.body.name, "Legacy_Name.example.com");
	const other = await addOk({ name: "other.example.com", dns_credential_id: made.id });
	const third = await addOk({ name: "third.example.com", dns_credential_id: made.id });
	const clash = await admin.put(`${RECORDS}/${other.id}`, { name: third.name });
	assert.equal(clash.status, 400);
	assert.equal(clash.body.error.message_i18n, "error.ddns-name-taken");
	assert.equal((await admin.put(`${RECORDS}/${other.id}`, { enabled: "x" })).status, 400);
});

it("lists, reads and expands records, and deletes one with its history", async () => {
	const made = await withDomain();
	const record = await addOk({ name: "list.example.com", dns_credential_id: made.id });
	await addOk({ name: "another.example.com", dns_credential_id: made.id });
	const list = await admin.get(`${RECORDS}?expand=credential,owner`);
	assert.equal(list.status, 200, list.text);
	assert.deepEqual(
		list.body.map((row) => row.name),
		["another.example.com", "list.example.com"],
	);
	assert.equal(list.body[0].credential.name, made.name);
	assert.equal("values" in list.body[0].credential, false);
	assert.equal(typeof list.body[0].owner.name, "string");
	assert.equal(list.text.includes(TOKEN), false);
	assert.equal((await admin.get(`${RECORDS}?query=LIST`)).body.length, 1);
	assert.equal((await admin.get(`${RECORDS}?expand=nothing`)).status, 400);
	const one = await admin.get(`${RECORDS}/${record.id}?expand=credential`);
	assert.equal(one.body.credential.id, made.id);
	await api
		.db("npmpro_ddns_history")
		.insert({ ddns_record_id: record.id, created_on: "2026-11-24 10:00:00", kind: "created", new_ip: OLD_IP });
	const gone = await admin.delete(`${RECORDS}/${record.id}`);
	assert.equal(gone.status, 200, gone.text);
	assert.equal((await admin.get(`${RECORDS}/${record.id}`)).status, 404);
	assert.equal((await api.db("npmpro_ddns_history").where({ ddns_record_id: record.id })).length, 0);
	assert.equal((await auditRows("deleted")).length, 1);
	assert.equal((await admin.get(`${RECORDS}/0`)).status, 400);
	assert.equal((await admin.get(`${RECORDS}/abc`)).status, 400);
});

it("Check now writes a changed record once, a second one inside the cooldown writes nothing, and the history shows the change", async () => {
	const made = await withDomain();
	const record = await addOk({ name: "home.example.com", dns_credential_id: made.id });
	const first = await admin.post("/nginx/ddns/check");
	assert.equal(first.status, 200, first.text);
	assert.deepEqual(cloudflare.patches, [{ content: PUBLIC_IP }]);
	assert.equal(first.body.ipv4.address, PUBLIC_IP);
	assert.equal(first.body.records, 1);
	const written = (await admin.get(`${RECORDS}/${record.id}`)).body;
	assert.equal(written.state, "ok");
	assert.equal(written.last_ipv4, PUBLIC_IP);
	assert.equal(Number.isNaN(Date.parse(written.last_changed_on)), false);
	const second = await admin.post("/nginx/ddns/check");
	assert.equal(second.status, 200, second.text);
	assert.equal(cloudflare.patches.length, 1);
	const history = await admin.get(`${RECORDS}/${record.id}/history`);
	assert.equal(history.status, 200, history.text);
	assert.equal(history.body.length, 1);
	assert.equal(history.body[0].kind, "changed");
	assert.equal(history.body[0].old_ip, OLD_IP);
	assert.equal(history.body[0].new_ip, PUBLIC_IP);
	assert.equal(history.body[0].ip_version, "ipv4");
	assert.equal(Number.isNaN(Date.parse(history.body[0].created_on)), false);
});

it("Update now answers the cooldown with the time of the next write, and a disabled record with its own error", async () => {
	const made = await withDomain();
	const record = await addOk({ name: "now.example.com", dns_credential_id: made.id });
	const written = await admin.post(`${RECORDS}/${record.id}/update`);
	assert.equal(written.status, 200, written.text);
	assert.equal(written.body.state, "ok");
	assert.equal(written.body.last_ipv4, PUBLIC_IP);
	assert.equal(cloudflare.patches.length, 1);
	const again = await admin.post(`${RECORDS}/${record.id}/update`);
	assert.equal(again.status, 400, again.text);
	assert.equal(again.body.error.message_i18n, "error.ddns-cooldown");
	assert.equal(Number.isNaN(Date.parse(again.body.error.message_values.next_write_on)), false);
	assert.equal(cloudflare.patches.length, 1);
	await admin.put(`${RECORDS}/${record.id}`, { enabled: false });
	const off = await admin.post(`${RECORDS}/${record.id}/update`);
	assert.equal(off.status, 400);
	assert.equal(off.body.error.message_i18n, "error.ddns-record-disabled");
	assert.equal((await admin.post(`${RECORDS}/9999/update`)).status, 404);
	assert.equal(
		(await auditRows("updated")).some((row) => JSON.parse(row.meta).update_now === true),
		true,
	);
});

it("shows the status of a failing echo and keeps records untouched while the address is not known", async () => {
	const made = await withDomain();
	const record = await addOk({ name: "echo.example.com", dns_credential_id: made.id });
	const none = await admin.get("/nginx/ddns/status");
	assert.equal(none.status, 200, none.text);
	assert.deepEqual(Object.keys(none.body.ipv4), ["address", "service", "checked_on", "error", "error_i18n"]);
	assert.equal(none.body.paused, false);
	assert.equal(none.body.running, false);
	assert.equal(none.body.next_run_on, null);
	const known = none.body.ipv4.address;
	assert.equal(none.body.records, 1);
	echo.status = 500;
	echo.body = "down";
	const failed = await admin.post("/nginx/ddns/check");
	assert.equal(failed.status, 200, failed.text);
	assert.equal(failed.body.ipv4.error_i18n, "error.ddns-ip-failed");
	assert.equal(typeof failed.body.ipv4.error, "string");
	assert.equal(failed.body.ipv4.address, known);
	assert.equal(cloudflare.patches.length, 0);
	const noAddress = await admin.post(`${RECORDS}/${record.id}/update`);
	assert.equal(noAddress.status, 400);
	assert.equal(noAddress.body.error.message_i18n, "error.ddns-ip-failed");
	echo.status = 200;
	// a private answer is no public address
	echo.body = "10.0.0.1";
	const priv = await admin.post("/nginx/ddns/check");
	assert.equal(priv.body.ipv4.error_i18n, "error.ddns-ip-failed");
});

it("counts only the enabled records the user can see, and lists the providers with their wildcards flag", async () => {
	const made = await withDomain();
	await addOk({ name: "on.example.com", dns_credential_id: made.id });
	await addOk({ name: "off.example.com", dns_credential_id: made.id, enabled: false });
	assert.equal((await admin.get("/nginx/ddns/status")).body.records, 1);
	const providers = await admin.get("/nginx/ddns/providers");
	assert.equal(providers.status, 200, providers.text);
	const byId = Object.fromEntries(providers.body.map((provider) => [provider.id, provider]));
	assert.deepEqual(
		Object.keys(byId).sort((a, b) => a.localeCompare(b)),
		[
			"cloudflare",
			"custom",
			"desec",
			"digitalocean",
			"duckdns",
			"dynu",
			"gandi",
			"hetzner-cloud",
			"namecheap",
			"noip",
			"ovh",
			"porkbun",
		],
	);
	assert.equal(byId.cloudflare.wildcards, true);
	assert.equal(byId.digitalocean.wildcards, true);
	assert.equal(byId["hetzner-cloud"].wildcards, false);
	assert.equal(byId.gandi.wildcards, false);
	assert.equal(byId.ovh.wildcards, false);
	assert.equal(byId.ovh.aliases, false);
	assert.equal(byId.ovh.apex, false);
	assert.equal(byId.ovh.min_ttl, null);
	assert.equal(byId.desec.min_ttl, 3600);
	assert.equal(byId.desec.aliases, false);
	assert.equal(byId.porkbun.min_ttl, 600);
	assert.equal(byId.cloudflare.aliases, true);
	assert.equal(byId.cloudflare.proxied, true);
	const dns = await admin.get("/nginx/certificates/dns-providers");
	const flag = (id) => dns.body.find((provider) => provider.id === id)?.ddns;
	for (const id of ["cloudflare", "desec", "digitalocean", "duckdns", "hetzner-cloud", "gandi", "ovh", "porkbun"]) {
		assert.equal(flag(id), true, id);
	}
	assert.equal(flag("acmedns"), false);
});

it("refuses wildcard, alias and apex records for OVH, and takes any TTL", async () => {
	const made = await makeCredential(admin, {
		provider: "ovh",
		fields: [
			{ key: "dns_ovh_endpoint", value: "ovh-eu" },
			{ key: "dns_ovh_application_key", value: "ak" },
			{ key: "dns_ovh_application_secret", value: "as-SECRET-1234" },
			{ key: "dns_ovh_consumer_key", value: "ck-SECRET-5678" },
		],
	});
	const added = await admin.post("/nginx/dns-domains", { dns_credential_id: made.id, names: ["example.com"] });
	assert.equal(added.status, 201, added.text);
	const refuse = async (body, key) => {
		const done = await add({ dns_credential_id: made.id, ...body });
		assert.equal(done.status, 400, `${done.text} ${JSON.stringify(body)}`);
		assert.equal(done.body.error.message_i18n, key, JSON.stringify(body));
	};
	await refuse({ name: "*.example.com" }, "error.ddns-wildcard-unsupported");
	await refuse({ name: "a.example.com", kind: "alias", target: "x.example.net" }, "error.ddns-alias-unsupported");
	await refuse({ name: "example.com" }, "error.ddns-apex-unsupported");
	const ok = await add({ dns_credential_id: made.id, name: "home.example.com", ttl: 30 });
	assert.equal(ok.status, 201, ok.text);
	assert.equal(ok.body.provider, "ovh");
	const toAlias = await admin.put(`${RECORDS}/${ok.body.id}`, { kind: "alias", target: "x.example.net" });
	assert.equal(toAlias.body.error.message_i18n, "error.ddns-alias-unsupported");
	const toApex = await admin.put(`${RECORDS}/${ok.body.id}`, { name: "example.com" });
	assert.equal(toApex.body.error.message_i18n, "error.ddns-apex-unsupported");
});

it("refuses a TTL under 3600 and a wildcard for deSEC, and has no zone fetch", async () => {
	const made = await makeCredential(admin, {
		provider: "desec",
		fields: [{ key: "dns_desec_token", value: "tok-SECRET-1234" }],
	});
	const added = await admin.post("/nginx/dns-domains", { dns_credential_id: made.id, names: ["example.com"] });
	assert.equal(added.status, 201, added.text);
	const low = await add({ dns_credential_id: made.id, name: "home.example.com", ttl: 600 });
	assert.equal(low.status, 400, low.text);
	assert.equal(low.body.error.message_i18n, "error.ddns-ttl-min");
	const wild = await add({ dns_credential_id: made.id, name: "*.example.com" });
	assert.equal(wild.body.error.message_i18n, "error.ddns-wildcard-unsupported");
	const ok = await add({ dns_credential_id: made.id, name: "home.example.com", ttl: 3600 });
	assert.equal(ok.status, 201, ok.text);
	const providers = await admin.get("/nginx/certificates/dns-providers");
	assert.equal(providers.body.find((provider) => provider.id === "desec").lists_domains, false);
});

it("refuses a TTL under 600 and a wildcard for Porkbun, and has no zone fetch", async () => {
	const made = await makeCredential(admin, {
		provider: "porkbun",
		fields: [
			{ key: "dns_porkbun_key", value: "pk1-SECRET-1234" },
			{ key: "dns_porkbun_secret", value: "sk1-SECRET-5678" },
		],
	});
	const added = await admin.post("/nginx/dns-domains", { dns_credential_id: made.id, names: ["example.com"] });
	assert.equal(added.status, 201, added.text);
	const low = await add({ dns_credential_id: made.id, name: "home.example.com", ttl: 300 });
	assert.equal(low.status, 400, low.text);
	assert.equal(low.body.error.message_i18n, "error.ddns-ttl-min");
	const wild = await add({ dns_credential_id: made.id, name: "*.example.com" });
	assert.equal(wild.body.error.message_i18n, "error.ddns-wildcard-unsupported");
	const ok = await add({ dns_credential_id: made.id, name: "home.example.com", ttl: 600 });
	assert.equal(ok.status, 201, ok.text);
	const providers = await admin.get("/nginx/certificates/dns-providers");
	assert.equal(providers.body.find((provider) => provider.id === "porkbun").lists_domains, false);
});

it("keeps DuckDNS records under duckdns.org: one label, no TTL, no alias, no wildcard, no domain to add", async () => {
	const made = await makeCredential(admin, {
		provider: "duckdns",
		fields: [{ key: "dns_duckdns_token", value: "tok-SECRET-1234" }],
	});
	const providers = await admin.get("/nginx/ddns/providers");
	const duck = providers.body.find((provider) => provider.id === "duckdns");
	assert.deepEqual(
		[duck.zoneless, duck.zone, duck.aliases, duck.wildcards, duck.min_ttl],
		[true, "duckdns.org", false, false, null],
	);
	const refuse = async (body, key) => {
		const done = await add({ dns_credential_id: made.id, ...body });
		assert.equal(done.status, 400, `${done.text} ${JSON.stringify(body)}`);
		assert.equal(done.body.error.message_i18n, key, JSON.stringify(body));
	};
	await refuse({ name: "home.example.com" }, "error.ddns-zoneless-name");
	await refuse({ name: "duckdns.org" }, "error.ddns-zoneless-name");
	await refuse({ name: "a.b.duckdns.org" }, "error.ddns-zoneless-name");
	await refuse({ name: "*.duckdns.org" }, "error.ddns-wildcard-unsupported");
	await refuse({ name: "*.home.duckdns.org" }, "error.ddns-wildcard-unsupported");
	await refuse({ name: "home.duckdns.org", ttl: 300 }, "error.ddns-ttl-unsupported");
	await refuse({ name: "home.duckdns.org", kind: "alias", target: "x.example.net" }, "error.ddns-alias-unsupported");
	// the domain is not on the credential and none is asked for; a typed zone is ignored
	const ok = await add({
		dns_credential_id: made.id,
		name: "Home.DuckDNS.org",
		zone: "example.com",
		ip_version: "both",
	});
	assert.equal(ok.status, 201, ok.text);
	assert.equal(ok.body.name, "home.duckdns.org");
	assert.equal(ok.body.zone, "duckdns.org");
	assert.equal(ok.body.ttl, null);
	const rename = await admin.put(`${RECORDS}/${ok.body.id}`, { name: "other.example.com" });
	assert.equal(rename.body.error.message_i18n, "error.ddns-zoneless-name");
	const withTtl = await admin.put(`${RECORDS}/${ok.body.id}`, { ttl: 600 });
	assert.equal(withTtl.body.error.message_i18n, "error.ddns-ttl-unsupported");
	const renamedOk = await admin.put(`${RECORDS}/${ok.body.id}`, { name: "next.duckdns.org", enabled: false });
	assert.equal(renamedOk.status, 200, renamedOk.text);
	assert.equal(renamedOk.body.zone, "duckdns.org");
	const answer = JSON.stringify(renamedOk.body);
	assert.ok(!answer.includes("tok-SECRET-1234"));
	await api.db("npmpro_ddns_record").del();
});

it("checks the IPv6 suffix of a DuckDNS record like any address record", async () => {
	const made = await makeCredential(admin, {
		provider: "duckdns",
		fields: [{ key: "dns_duckdns_token", value: "tok-SECRET-1234" }],
	});
	const body = { dns_credential_id: made.id, name: "suffix.duckdns.org" };
	const bad = await add({ ...body, ip_version: "ipv4", ipv6_suffix: "::1" });
	assert.equal(bad.body.error.message_i18n, "error.ddns-suffix-needs-ipv6");
	const invalid = await add({ ...body, ip_version: "ipv6", ipv6_suffix: "not-a-suffix" });
	assert.equal(invalid.body.error.message_i18n, "error.ddns-suffix-invalid");
	const ok = await add({ ...body, ip_version: "both", ipv6_suffix: "::a:b" });
	assert.equal(ok.status, 201, ok.text);
	assert.equal(ok.body.ipv6_suffix, "::a:b");
	// the stored suffix passes a save that keeps it
	const kept = await admin.put(`${RECORDS}/${ok.body.id}`, { enabled: false });
	assert.equal(kept.status, 200, kept.text);
	await api.db("npmpro_ddns_record").del();
});

it("refuses a credential delete and a provider change while a record uses it", async () => {
	const made = await withDomain();
	await addOk({ name: "used.example.com", dns_credential_id: made.id });
	const del = await admin.delete(`/nginx/dns-credentials/${made.id}`);
	assert.equal(del.status, 400, del.text);
	assert.equal(del.body.error.message_i18n, "error.dns-credential-in-use-ddns");
	assert.equal(del.body.error.message_values.count, 1);
	const change = await admin.put(`/nginx/dns-credentials/${made.id}`, {
		provider: "digitalocean",
		fields: [{ key: "dns_digitalocean_token", value: "do-token-1234567890" }],
	});
	assert.equal(change.status, 400, change.text);
	assert.equal(change.body.error.message_i18n, "error.dns-credential-in-use-ddns");
	const rename = await admin.put(`/nginx/dns-credentials/${made.id}`, { name: "Renamed while used" });
	assert.equal(rename.status, 200, rename.text);
	await api.db("npmpro_ddns_record").del();
	assert.equal((await admin.delete(`/nginx/dns-credentials/${made.id}`)).status, 200);
});

it("keeps the token out of every answer, error column, history row and audit entry", async () => {
	const made = await withDomain();
	const record = await addOk({ name: "leak.example.com", dns_credential_id: made.id });
	cloudflare.failWith = { success: false, errors: [{ code: 9109, message: `Invalid token ${TOKEN}` }] };
	const run = await admin.post(`${RECORDS}/${record.id}/update`);
	assert.equal(run.status, 200, run.text);
	assert.equal(run.body.state, "failed");
	assert.match(run.body.error, STARS);
	const row = await api.db("npmpro_ddns_record").where({ id: record.id }).first();
	const history = await api.db("npmpro_ddns_history").where({ ddns_record_id: record.id });
	const audit = await api.db("audit_log").where({ object_type: "ddns-record" });
	for (const text of [
		JSON.stringify(row),
		JSON.stringify(history),
		JSON.stringify(audit),
		run.text,
		(await admin.get(`${RECORDS}/${record.id}/history`)).text,
		(await admin.get(`${RECORDS}?expand=credential,owner`)).text,
		(await admin.get("/nginx/ddns/status")).text,
	]) {
		assert.equal(text.includes(TOKEN), false);
	}
	assert.equal(
		history.some((entry) => entry.kind === "failed"),
		true,
	);
});

it("hides another owner's records and credentials, and answers 404 on a direct request", async () => {
	const own = await api.limited({ visibility: "user", certificates: "manage" });
	const theirs = await withDomain(admin);
	const hiddenRecord = await addOk({ name: "admin.example.com", dns_credential_id: theirs.id });
	const mine = await withDomain(own, "mine.example");
	const myRecord = await addOk({ name: "me.mine.example", dns_credential_id: mine.id }, own);
	assert.deepEqual(
		(await own.get(RECORDS)).body.map((row) => row.name),
		["me.mine.example"],
	);
	assert.equal((await admin.get(RECORDS)).body.length, 2);
	for (const [method, url, body] of [
		["get", `${RECORDS}/${hiddenRecord.id}`],
		["put", `${RECORDS}/${hiddenRecord.id}`, { ttl: 300 }],
		["delete", `${RECORDS}/${hiddenRecord.id}`],
		["post", `${RECORDS}/${hiddenRecord.id}/update`],
		["get", `${RECORDS}/${hiddenRecord.id}/history`],
	]) {
		assert.equal((await own[method](url, body)).status, 404, `${method} ${url}`);
	}
	const usingTheirs = await add({ name: "steal.example.com", dns_credential_id: theirs.id }, own);
	assert.equal(usingTheirs.status, 404);
	assert.equal((await own.get(`${RECORDS}/${myRecord.id}`)).status, 200);
	assert.equal((await own.get("/nginx/ddns/status")).body.records, 1);
	// the administrator sees both
	assert.equal((await admin.get(`${RECORDS}/${myRecord.id}`)).status, 200);
});

it("gives a record its credential's owner, also when an administrator saves it or moves it", async () => {
	const own = await api.limited({ visibility: "user", certificates: "manage" });
	const theirs = await withDomain(own, "theirs.example");
	const record = await addOk({ name: "by-admin.theirs.example", dns_credential_id: theirs.id });
	assert.equal(record.owner_user_id, theirs.owner_user_id);
	assert.notEqual(record.owner_user_id, (await admin.get("/users/me")).body.id);
	assert.deepEqual(
		(await own.get(RECORDS)).body.map((row) => row.name),
		["by-admin.theirs.example"],
	);
	const mine = await withDomain(admin, "theirs.example");
	const moved = await admin.put(`${RECORDS}/${record.id}`, { dns_credential_id: mine.id });
	assert.equal(moved.status, 200, moved.text);
	assert.equal(moved.body.owner_user_id, mine.owner_user_id);
	assert.equal((await own.get(RECORDS)).body.length, 0);
});

it("follows the certificates permission: view reads, manage writes, hidden refuses, a view token reads only", async () => {
	const made = await withDomain();
	const record = await addOk({ name: "perm.example.com", dns_credential_id: made.id });
	const viewer = await api.limited({ visibility: "all", certificates: "view" });
	const hidden = await api.limited({ visibility: "all", certificates: "hidden" });
	const reads = [
		RECORDS,
		`${RECORDS}/${record.id}`,
		`${RECORDS}/${record.id}/history`,
		"/nginx/ddns/status",
		"/nginx/ddns/providers",
	];
	const writes = [
		["post", RECORDS, { name: "x.example.com", dns_credential_id: made.id }],
		["put", `${RECORDS}/${record.id}`, { ttl: 300 }],
		["delete", `${RECORDS}/${record.id}`],
		["post", `${RECORDS}/${record.id}/update`],
		["post", "/nginx/ddns/check"],
	];
	for (const url of reads) {
		assert.equal((await viewer.get(url)).status, 200, `view ${url}`);
		assert.equal((await hidden.get(url)).status, 403, `hidden ${url}`);
	}
	for (const [method, url, body] of writes) {
		assert.equal((await viewer[method](url, body)).status, 403, `view ${method} ${url}`);
		assert.equal((await hidden[method](url, body)).status, 403, `hidden ${method} ${url}`);
	}
	const made2 = await admin.post("/users/me/api-tokens", {
		name: "ddns",
		permissions: Object.fromEntries(
			SECTIONS.map((section) => [section, section === "certificates" ? "view" : "hidden"]),
		),
	});
	assert.equal(made2.status, 201, made2.text);
	const headers = { authorization: `Bearer ${made2.body.token}` };
	assert.equal((await api.client().get(RECORDS, { headers })).status, 200);
	assert.equal((await api.client().post("/nginx/ddns/check", undefined, { headers })).status, 403);
	assert.equal(
		(await api.client().post(RECORDS, { name: "t.example.com", dns_credential_id: made.id }, { headers })).status,
		403,
	);
	for (const [method, url, body] of [["get", RECORDS], ...writes]) {
		assert.equal((await api.client()[method](url, body)).status, 401, `no session ${method} ${url}`);
	}
	assert.equal((await admin.get(`${RECORDS}/${record.id}`)).status, 200);
});

it("refuses at the schema an alias without a target or with a suffix, and an address with a target", async () => {
	const made = await withDomain();
	const base = { name: "s.example.com", dns_credential_id: made.id };
	for (const body of [
		{ kind: "alias" },
		{ kind: "alias", target: null },
		{ kind: "alias", target: "x.example.net", ipv6_suffix: "::1" },
		{ kind: "address", target: "x.example.net" },
	]) {
		const done = await add({ ...base, ...body });
		assert.equal(done.status, 400, JSON.stringify(body));
		assert.equal(done.body.error.message_i18n, undefined, JSON.stringify(body));
	}
	const alias = await addOk({ ...base, kind: "alias", target: "x.example.net", ipv6_suffix: null });
	// a stored alias keeps its ip_version on a save that repeats it
	const kept = await admin.put(`${RECORDS}/${alias.id}`, {
		kind: "alias",
		target: "x.example.net",
		ip_version: "ipv4",
	});
	assert.equal(kept.status, 200, kept.text);
	for (const body of [
		{ kind: "alias", target: null },
		{ kind: "alias", ipv6_suffix: "::1" },
		{ kind: "address", target: "y.example.net" },
	]) {
		assert.equal((await admin.put(`${RECORDS}/${alias.id}`, body)).status, 400, JSON.stringify(body));
	}
	assert.equal((await admin.put(`${RECORDS}/${alias.id}`, { target: "z.example.net" })).status, 200);
});

it("clears the learned addresses and sets pending when the kind changes", async () => {
	const made = await withDomain();
	const record = await addOk({ name: "kind.example.com", dns_credential_id: made.id });
	await api.db("npmpro_ddns_record").where({ id: record.id }).update({
		state: "ok",
		last_ipv4: PUBLIC_IP,
		last_ipv6: "2a00:1450:4001:80b::200e",
		last_checked_on: "2026-11-24 10:00:00.000",
	});
	const alias = await admin.put(`${RECORDS}/${record.id}`, { kind: "alias", target: "lb.example.net" });
	assert.equal(alias.status, 200, alias.text);
	assert.equal(alias.body.state, "pending");
	assert.equal(alias.body.last_ipv4, null);
	assert.equal(alias.body.last_ipv6, null);
	assert.equal(alias.body.last_checked_on, null);
	await api.db("npmpro_ddns_record").where({ id: record.id }).update({ state: "ok", last_ipv4: PUBLIC_IP });
	const back = await admin.put(`${RECORDS}/${record.id}`, { kind: "address", target: null });
	assert.equal(back.status, 200, back.text);
	assert.equal(back.body.target, null);
	assert.equal(back.body.state, "pending");
	assert.equal(back.body.last_ipv4, null);
});

it("audits Update now with the credential name", async () => {
	const made = await withDomain();
	const record = await addOk({ name: "audit.example.com", dns_credential_id: made.id });
	assert.equal((await admin.post(`${RECORDS}/${record.id}/update`)).status, 200);
	const entry = (await auditRows("updated")).find((row) => JSON.parse(row.meta).update_now === true);
	const meta = JSON.parse(entry.meta);
	assert.equal(meta.credential_name, made.name);
	assert.equal(meta.dns_credential_id, made.id);
});

it("lets Check now of a limited user run only the records that user sees", async () => {
	const own = await api.limited({ visibility: "user", certificates: "manage" });
	const theirs = await withDomain(admin);
	const adminRecord = await addOk({ name: "admin-only.example.com", dns_credential_id: theirs.id });
	const mine = await withDomain(own, "mine.example");
	const myRecord = await addOk({ name: "me.mine.example", dns_credential_id: mine.id }, own);
	const run = await own.post("/nginx/ddns/check");
	assert.equal(run.status, 200, run.text);
	assert.equal(cloudflare.patches.length, 1);
	assert.equal((await admin.get(`${RECORDS}/${myRecord.id}`)).body.state, "ok");
	const untouched = (await admin.get(`${RECORDS}/${adminRecord.id}`)).body;
	assert.equal(untouched.state, "pending");
	assert.equal(untouched.last_checked_on, null);
	// an administrator with visibility all covers every record
	assert.equal((await admin.post("/nginx/ddns/check")).status, 200);
	assert.equal((await admin.get(`${RECORDS}/${adminRecord.id}`)).body.state, "ok");
});
