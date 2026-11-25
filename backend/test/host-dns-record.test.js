import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { startApi } from "./support/api.js";

// The host record service (internal/host-dns-record.js): every state of a host's name and the change between them,
// with a fake provider that counts its calls, a fake reach probe, a fake clock and the real engine and database.

const IP4 = "81.2.69.160";
const NEW_IP4 = "81.2.69.161";
const IP6 = "2001:db8:1::5";
const OTHER = "192.0.2.5";
const ZONE = "example.com";
const HEX_ZONE = "c".repeat(32);
const ZONE_DETAIL = /zone 42/u;

let api;
let admin;
let errs;
let DdnsProviderError;
let internalDdnsRecord;
let managedRows;
let recordLock;
let service;
let engine;
let createHostDnsRecords;
let credentialId;
let hostCount = 0;

const clock = { at: Date.parse("2026-11-25T10:00:00Z"), now: () => clock.at };
const net = {
	ipv4: IP4,
	ipv6: null,
	asked: 0,
	// the detector's confirmed IPv4 as it is known without a detection: the detected one unless a test says otherwise
	get known4() {
		return this.unknown ? null : this.ipv4;
	},
	unknown: false,
};
const probe = { result: "reachable", calls: 0 };
// the ids of the hosts a test deleted (the hosts of these tests are not rows: the service is told this way)
const gone = new Set();
// the hosts a test disabled while a job ran, and the pause a restore takes
const disabledHosts = new Set();
const ddnsPause = { on: false };

/** A provider at a fake DNS host: its records by name and type, every call counted */
const fake = {
	records: new Map(),
	calls: { read: 0, write: 0, remove: 0 },
	writes: [],
	removes: [],
	fail: { write: false, remove: false, read429: false },
	ids: 0,
	reset() {
		this.calls = { read: 0, write: 0, remove: 0 };
		this.writes = [];
		this.removes = [];
		this.fail = { write: false, remove: false, read429: false };
		provider.minTtl = 60;
	},
	total() {
		return this.calls.read + this.calls.write + this.calls.remove;
	},
	set(name, type, values, extra = {}) {
		this.ids += 1;
		this.records.set(`${name}|${type}`, { id: `rec${this.ids}`, values, ttl: 120, proxied: false, ...extra });
	},
	get(name, type) {
		return this.records.get(`${name}|${type}`) ?? null;
	},
};

const provider = {
	id: "cloudflare",
	label: "Cloudflare",
	credentialProvider: "cloudflare",
	recordTypes: ["A", "AAAA", "CNAME"],
	proxied: true,
	ipv6: true,
	wildcards: true,
	aliases: true,
	minTtl: 60,
	read({ name, type }) {
		fake.calls.read += 1;
		if (fake.fail.read429) {
			return Promise.reject(new DdnsProviderError({ providerStatus: 429, code: "rate", message: "HTTP 429" }));
		}
		const found = fake.get(name, type);
		return Promise.resolve(
			found
				? { values: [...found.values], ttl: found.ttl, proxied: found.proxied, meta: { record_id: found.id } }
				: null,
		);
	},
	write({ name, type, ip, ttl, existing, meta }) {
		fake.calls.write += 1;
		const proxied = existing ? undefined : meta?.proxied_on_create === true;
		fake.writes.push({ name, type, ip, ttl, create: !existing, proxied });
		if (fake.fail.write) return Promise.reject(new DdnsProviderError({ code: "failed", message: "HTTP 500" }));
		const old = fake.get(name, type);
		fake.set(name, type, [ip], { ttl: ttl ?? old?.ttl ?? 1, proxied: old?.proxied ?? proxied });
		return Promise.resolve({ meta: {}, created: !existing });
	},
	// as Cloudflare: a stored record id that is not the found record's means another client's record (changed)
	remove({ name, type, value, meta }) {
		fake.calls.remove += 1;
		fake.removes.push({ name, type, value });
		if (fake.fail.remove) {
			return Promise.reject(new DdnsProviderError({ code: "failed", message: "HTTP 500 at the provider" }));
		}
		const found = fake.get(name, type);
		if (found === null) return Promise.resolve({ gone: true });
		if (found.values.length !== 1 || found.values[0] !== value || (meta?.record_id && meta.record_id !== found.id))
			return Promise.resolve({ gone: false, changed: true });
		fake.records.delete(`${name}|${type}`);
		return Promise.resolve({ gone: true });
	},
};

/** An Access as the internal modules read it */
const accessOf = ({ userId = 1, certificates = "manage", hosts = "manage", visibility = "all" } = {}) => ({
	isAdmin: false,
	visibility,
	apiToken: null,
	token: { getUserId: () => userId },
	level: (section) => (section === "certificates" ? certificates : hosts),
	can: (permission) => {
		const [type, required] = permission.split(":");
		const level = type === "certificates" ? certificates : hosts;
		if (level === "manage" || level === required) return true;
		throw new errs.PermissionError();
	},
});
const manager = accessOf();

const makeService = (extra = {}) =>
	createHostDnsRecords({
		providerFor: (credentialProvider) => (credentialProvider === "cloudflare" ? provider : null),
		publicAddress: (family) => {
			net.asked += 1;
			return Promise.resolve(family === 4 ? net.ipv4 : net.ipv6);
		},
		probe: ({ address }) => {
			probe.calls += 1;
			if (address === null) return Promise.resolve({ result: "no-public-address", port: null, detail: "none" });
			return Promise.resolve({
				result: probe.result,
				port: probe.result === "reachable" ? 80 : null,
				detail: "",
			});
		},
		// the detector's confirmed address as the save reads it (never a detection, not counted)
		knownAddress: (family) => (family === 4 ? net.known4 : null),
		writeRecord: (id) => engine.updateRecord(id),
		hostExists: (_type, id) => Promise.resolve(!gone.has(id)),
		hostEnabled: (_type, id) => Promise.resolve(!gone.has(id) && !disabledHosts.has(id)),
		paused: () => ddnsPause.on,
		pollMs: 5,
		clock,
		log: { warn: () => undefined },
		...extra,
	});

/** A host as the host service hands it over; a real host row when the test needs one (Adopt, Leave, the label) */
const hostOf = (names, extra = {}) => {
	hostCount += 1;
	return { id: 9000 + hostCount, domain_names: names, enabled: true, locations: [], ...extra };
};
const realHost = async (names) => {
	const made = await admin.post("/nginx/proxy-hosts", {
		domain_names: names,
		forward_scheme: "http",
		forward_host: "10.0.9.1",
		forward_port: 8080,
	});
	if (made.status !== 201) throw new Error(`host create answered ${made.status}: ${made.text}`);
	return { ...made.body, locations: [] };
};
let nameCount = 0;
const freshName = (prefix = "n") => {
	nameCount += 1;
	return `${prefix}${nameCount}.${ZONE}`;
};

// a tick in these tests says "I checked from outside" unless it sets reach_confirmed itself
const confirmedTicks = (wanted) =>
	wanted?.map((entry) => ("reach_confirmed" in entry ? entry : { ...entry, reach_confirmed: true }));
const settle = (host) => service.idle("proxy_host", host.id);
const runEngine = (id) => engine.updateRecord(id);
const hostStates = (host, access = manager) => service.statesOf(access, { hostType: "proxy_host", host });
/** A save: its answer comes at once; the host's job is then waited for and the states read back */
const apply = async (host, wanted, access = manager) => {
	await service.applyHost(access, {
		hostType: "proxy_host",
		hostBefore: null,
		hostAfter: host,
		wanted: confirmedTicks(wanted),
	});
	await service.idle("proxy_host", host.id);
	return await hostStates(host, access);
};
/** A host's delete and its job; the states left (orphans) */
const deleteHost = async (host) => {
	gone.add(host.id);
	await service.onDelete(manager, { hostType: "proxy_host", host });
	await service.idle("proxy_host", host.id);
	return await hostStates(host);
};
const stateOf = (states, name) => states.find((one) => one.name === name);
const rowOf = (name) => api.db("npmpro_ddns_record").where({ name }).first();
const metaOf = async (name) => JSON.parse((await rowOf(name)).meta ?? "{}");
const historyOf = async (name) => {
	const row = await rowOf(name);
	return api.db("npmpro_ddns_history").where({ ddns_record_id: row.id }).orderBy("id");
};

/** A provider call held until the test opens it; started resolves when the job reached it */
const hold = (method, match = () => true) => {
	const original = provider[method];
	let open;
	let reached;
	const gate = new Promise((resolve) => {
		open = resolve;
	});
	const started = new Promise((resolve) => {
		reached = resolve;
	});
	let held = false;
	provider[method] = async (args) => {
		if (!held && match(args)) {
			held = true;
			reached();
			await gate;
		}
		return await original(args);
	};
	return {
		started,
		open: () => {
			provider[method] = original;
			open();
		},
	};
};

before(async () => {
	api = await startApi();
	admin = await api.admin();
	const credential = await admin.post("/nginx/dns-credentials", {
		name: "Host records",
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: "host-record-token-0123456789" }],
	});
	if (credential.status !== 201) throw new Error(`credential create answered ${credential.status}`);
	credentialId = credential.body.id;
	const domain = await admin.post("/nginx/dns-domains", { dns_credential_id: credentialId, names: [ZONE] });
	if (domain.status !== 201) throw new Error(`domain add answered ${domain.status}`);
	errs = (await import("../lib/error.js")).default;
	({ DdnsProviderError } = await import("../lib/ddns/errors.js"));
	const records = await import("../internal/ddns-record.js");
	internalDdnsRecord = records.default;
	({ managedRows, recordLock } = records);
	({ createHostDnsRecords } = await import("../internal/host-dns-record.js"));
	const { createDdnsEngine } = await import("../lib/ddns/engine.js");
	engine = createDdnsEngine({
		store: records.ddnsStore,
		publicIp: {
			detect: (family) => Promise.resolve({ address: family === 4 ? net.ipv4 : net.ipv6 }),
		},
		providers: { providerById: (id) => (id === "cloudflare" ? provider : null) },
		resolveName: () => Promise.resolve(null),
		settings: () => ({ periodMs: 300_000, cooldownMs: 0, resolvers: [] }),
		clock,
		recordLock: records.recordLock,
	});
	service = makeService();
});
beforeEach(() => {
	fake.reset();
	net.ipv4 = IP4;
	net.ipv6 = null;
	net.asked = 0;
	net.unknown = false;
	ddnsPause.on = false;
	probe.result = "reachable";
	probe.calls = 0;
});
after(() => api?.stop());

describe("the life cycle of a name, one transition per row", () => {
	// each row: the state before (built by `from`), the event, the state after and the provider calls of the event
	const created = async (host, name) => {
		const states = await apply(host, [{ name }]);
		if (stateOf(states, name).state !== "ok")
			throw new Error(`the create did not end ok: ${JSON.stringify(states)}`);
	};
	const adopted = async (host, name) => {
		fake.set(name, "A", [IP4]);
		await apply(host, [{ name }]);
	};
	const exists = async (host, name) => {
		fake.set(name, "A", [OTHER]);
		await apply(host, [{ name }]);
	};
	const recordId = async (name) => (await rowOf(name)).id;
	const TABLE = [
		{
			from: "off",
			event: "tick, nothing at the name",
			to: "ok",
			origin: "created",
			calls: { write: 1, remove: 0 },
		},
		{
			from: "off",
			event: "tick, the wanted address is there",
			setup: (name) => fake.set(name, "A", [IP4]),
			to: "ok",
			origin: "adopted",
			calls: { write: 0, remove: 0 },
		},
		{
			from: "off",
			event: "tick, another address is there",
			setup: (name) => fake.set(name, "A", [OTHER]),
			to: "exists",
			adoptAllowed: true,
			calls: { write: 0, remove: 0 },
		},
		{
			from: "off",
			event: "tick, two addresses are there",
			setup: (name) => fake.set(name, "A", [IP4, OTHER]),
			to: "exists",
			adoptAllowed: false,
			calls: { write: 0, remove: 0 },
		},
		{
			from: "off",
			event: "tick, a CNAME is there",
			setup: (name) => fake.set(name, "CNAME", ["elsewhere.example.net"]),
			to: "exists",
			adoptAllowed: false,
			calls: { write: 0, remove: 0 },
		},
		{
			from: "off",
			event: "tick, a wildcard at the parent covers it",
			setup: (name) => fake.set(`*.${name.slice(name.indexOf(".") + 1)}`, "A", [IP4]),
			to: "covered",
			calls: { write: 0, remove: 0 },
			cleanup: (name) => fake.records.delete(`*.${name.slice(name.indexOf(".") + 1)}|A`),
		},
		{
			from: "off",
			event: "tick, reach neither proven nor confirmed",
			tick: { reach_confirmed: false },
			to: "unavailable",
			reason: "error.host-dns-reach-unconfirmed",
			calls: { write: 0, remove: 0 },
		},
		{
			from: "off",
			event: "tick, the provider fails the create",
			setup: () => {
				fake.fail.write = true;
			},
			to: "failed",
			origin: "created",
			calls: { write: 1, remove: 0 },
		},
		{
			from: "exists",
			build: exists,
			event: "Adopt and update",
			run: async (_host, name) => service.adopt(manager, { id: await recordId(name) }),
			to: "ok",
			origin: "adopted",
			calls: { write: 1, remove: 0 },
		},
		{
			from: "exists",
			build: exists,
			event: "Leave alone",
			run: async (_host, name) => service.leave(manager, { id: await recordId(name) }),
			to: "off",
			calls: { write: 0, remove: 0 },
		},
		{
			from: "exists",
			build: exists,
			event: "untick",
			run: (host) => apply(host, []),
			to: "off",
			calls: { write: 0, remove: 0 },
		},
		{
			from: "ok (created)",
			build: created,
			event: "untick",
			run: (host) => apply(host, []),
			to: "off",
			calls: { write: 0, remove: 1 },
		},
		{
			from: "ok (adopted)",
			build: adopted,
			event: "untick",
			run: (host) => apply(host, []),
			to: "off",
			calls: { write: 0, remove: 0 },
		},
		{
			from: "ok (created)",
			build: created,
			event: "untick, the provider fails the delete",
			run: (host) => {
				fake.fail.remove = true;
				return apply(host, []);
			},
			to: "orphan",
			origin: "created",
			calls: { write: 0, remove: 1 },
		},
		{
			from: "ok (created)",
			build: created,
			event: "host disabled",
			run: (host) => service.onDisable(manager, { hostType: "proxy_host", host }),
			to: "paused",
			origin: "created",
			calls: { write: 0, remove: 0 },
		},
		{
			from: "paused",
			build: async (host, name) => {
				await created(host, name);
				await service.onDisable(manager, { hostType: "proxy_host", host });
			},
			event: "host enabled",
			run: (host) => service.onEnable(manager, { hostType: "proxy_host", host }),
			to: "pending",
			origin: "created",
			calls: { write: 0, remove: 0 },
		},
		{
			from: "paused",
			build: async (host, name) => {
				await created(host, name);
				await service.onDisable(manager, { hostType: "proxy_host", host });
			},
			event: "untick",
			run: (host) => apply(host, []),
			to: "off",
			calls: { write: 0, remove: 1 },
		},
		{
			from: "ok (created)",
			build: created,
			event: "host deleted",
			run: (host) => service.onDelete(manager, { hostType: "proxy_host", host }),
			to: "off",
			calls: { write: 0, remove: 1 },
		},
		{
			from: "ok (adopted)",
			build: adopted,
			event: "host deleted",
			run: (host) => service.onDelete(manager, { hostType: "proxy_host", host }),
			to: "off",
			calls: { write: 0, remove: 0 },
		},
		{
			from: "orphan",
			build: async (host, name) => {
				await created(host, name);
				fake.fail.remove = true;
				await apply(host, []);
				fake.fail.remove = false;
			},
			event: "delete at the provider again",
			run: async (_host, name) => service.removeAtProvider(manager, { id: await recordId(name) }),
			to: "off",
			calls: { write: 0, remove: 1 },
		},
		{
			from: "orphan",
			build: async (host, name) => {
				await created(host, name);
				fake.fail.remove = true;
				await apply(host, []);
				fake.fail.remove = false;
			},
			event: "ticked again",
			run: (host, name) => apply(host, [{ name }]),
			to: "ok",
			origin: "created",
			calls: { write: 0, remove: 0 },
		},
	];

	const noRow = new Set(["covered", "unavailable", "off"]);

	for (const row of TABLE) {
		it(`${row.from} --${row.event}--> ${row.to}`, async () => {
			const name = freshName("t");
			// Adopt and update and Leave alone look the host up
			const host = row.from === "exists" ? await realHost([name]) : hostOf([name]);
			await row.build?.(host, name);
			await row.setup?.(name);
			const start = { ...fake.calls };
			// the states after the event and the host's job (a refused or covered tick keeps no row, only its result)
			const event = row.run ?? ((on, named) => apply(on, [{ name: named, ...row.tick }]));
			await event(host, name);
			await settle(host);
			const states = await hostStates(host);
			const shown = stateOf(states, name) ?? { state: "off" };
			const expected = {
				state: row.to,
				...(row.origin === undefined ? {} : { origin: row.origin }),
				...(row.adoptAllowed === undefined ? {} : { adopt_allowed: row.adoptAllowed }),
				...(row.reason === undefined ? {} : { reason: row.reason }),
			};
			assert.deepEqual(Object.fromEntries(Object.keys(expected).map((key) => [key, shown[key]])), expected);
			assert.deepEqual(
				{ write: fake.calls.write - start.write, remove: fake.calls.remove - start.remove },
				row.calls,
				"the provider calls of the event",
			);
			assert.equal(Boolean(await rowOf(name)), !noRow.has(row.to), "whether a row keeps the name");
			row.cleanup?.(name);
		});
	}
});

describe("the life cycle in detail", () => {
	it("a created record: A at the public address, TTL 300, not proxied, written by the engine with a history row", async () => {
		const name = freshName("c");
		const host = hostOf([name, freshName("other")]);
		// the window probed the name a moment ago: the save takes that result, the box is not needed
		assert.equal((await service.reach(manager, { hostType: "proxy_host", host, name })).result, "reachable");
		const states = await apply(host, [{ name, reach_confirmed: false }]);
		assert.equal(stateOf(states, name).state, "ok");
		assert.equal(stateOf(states, name).origin, "created");
		assert.equal(states[1].state, "off", "a name that was not ticked is not touched");
		assert.deepEqual(fake.writes, [{ name, type: "A", ip: IP4, ttl: 300, create: true, proxied: false }]);
		assert.equal(fake.get(states[1].name, "A"), null);
		const row = await rowOf(name);
		assert.equal(row.host_type, "proxy_host");
		assert.equal(row.host_id, host.id);
		assert.equal(row.ttl, 300);
		assert.equal(row.dns_credential_id, credentialId);
		const meta = await metaOf(name);
		assert.equal(meta.reach.result, "reachable");
		assert.equal(meta.reach.confirmed, false);
		assert.equal(meta.reach.user_id, 1);
		assert.equal(meta.reach.checked_on, new Date(clock.at).toISOString());
		assert.deepEqual(
			(await historyOf(name)).map((one) => [one.kind, one.new_ip]),
			[["created", IP4]],
		);
	});

	it("adopting the same address writes nothing and keeps the record's TTL; deleting the host leaves it", async () => {
		const name = freshName("a");
		fake.set(name, "A", [IP4], { ttl: 120 });
		const host = hostOf([name]);
		const states = await apply(host, [{ name }]);
		assert.equal(stateOf(states, name).state, "ok");
		assert.equal(stateOf(states, name).origin, "adopted");
		assert.equal(fake.calls.write, 0);
		assert.equal((await rowOf(name)).ttl, null, "an existing record keeps its TTL");
		await deleteHost(host);
		assert.equal(fake.calls.remove, 0);
		assert.deepEqual(fake.get(name, "A").values, [IP4]);
		assert.equal(await rowOf(name), undefined);
	});

	it("another address: exists, nothing written; Adopt and update writes it with the old value in the history", async () => {
		const name = freshName("e");
		fake.set(name, "A", [OTHER], { ttl: 900 });
		const host = await realHost([name]);
		const states = await apply(host, [{ name }]);
		const line = stateOf(states, name);
		assert.equal(line.state, "exists");
		assert.equal(line.adopt_allowed, true);
		assert.deepEqual(line.found, [{ type: "A", values: [OTHER] }]);
		assert.equal(line.message, `A ${OTHER} already exists here`);
		assert.equal(fake.calls.write, 0);
		assert.equal((await rowOf(name)).enabled, 0);
		// the engine never runs a row that waits for the user's choice
		await engine.cycle({ force: true, ids: [(await rowOf(name)).id] });
		assert.equal(fake.calls.write, 0);

		const adopted = await service.adopt(manager, { id: line.record_id });
		assert.equal(adopted.state, "ok");
		assert.equal(adopted.origin, "adopted");
		assert.deepEqual(fake.writes, [
			{ name, type: "A", ip: IP4, ttl: undefined, create: false, proxied: undefined },
		]);
		assert.equal(fake.get(name, "A").ttl, 900, "the TTL stays");
		assert.deepEqual(
			(await historyOf(name)).map((one) => [one.kind, one.old_ip, one.new_ip]),
			[["changed", OTHER, IP4]],
		);
		// an adopted record is never deleted at the provider
		await apply(host, []);
		assert.equal(fake.calls.remove, 0);
		assert.deepEqual(fake.get(name, "A").values, [IP4]);
	});

	it("Adopt is refused for two values or a CNAME; Leave alone removes only the row", async () => {
		const name = freshName("m");
		fake.set(name, "A", [IP4, OTHER]);
		const host = await realHost([name]);
		const line = stateOf(await apply(host, [{ name }]), name);
		assert.equal(line.state, "exists");
		assert.equal(line.adopt_allowed, false);
		await assert.rejects(service.adopt(manager, { id: line.record_id }), (error) => {
			assert.equal(
				error.message_i18n ?? error.i18n ?? error.messageI18n ?? "error.host-dns-adopt-refused",
				"error.host-dns-adopt-refused",
			);
			return error instanceof errs.ValidationError;
		});
		const left = await service.leave(manager, { id: line.record_id });
		assert.equal(left.state, "off");
		assert.equal(await rowOf(name), undefined);
		assert.deepEqual(fake.get(name, "A").values, [IP4, OTHER]);
		assert.equal(fake.calls.write + fake.calls.remove, 0);
		// Leave alone is for a name that holds another record only
		const own = freshName("own");
		const ownHost = await realHost([own]);
		await apply(ownHost, [{ name: own }]);
		await assert.rejects(service.leave(manager, { id: (await rowOf(own)).id }), errs.ValidationError);
	});

	it("a renamed host: the old name's created record is deleted, the new name is created", async () => {
		const oldName = freshName("old");
		const newName = freshName("new");
		const host = hostOf([oldName]);
		await apply(host, [{ name: oldName }]);
		fake.reset();
		const renamed = { ...host, domain_names: [newName] };
		const states = await apply(renamed, [{ name: newName }]);
		assert.deepEqual(fake.removes, [{ name: oldName, type: "A", value: IP4 }]);
		assert.equal(fake.get(oldName, "A"), null);
		assert.equal(stateOf(states, newName).state, "ok");
		assert.equal(fake.writes.length, 1);
		assert.equal(await rowOf(oldName), undefined);
	});

	it("a save that leaves the option alone still releases a name the host lost", async () => {
		const keep = freshName("keep");
		const lost = freshName("lost");
		const host = hostOf([keep, lost]);
		await apply(host, [{ name: keep }, { name: lost }]);
		fake.reset();
		const states = await apply({ ...host, domain_names: [keep] }, undefined);
		assert.deepEqual(fake.removes, [{ name: lost, type: "A", value: IP4 }]);
		assert.deepEqual(
			states.map((one) => [one.name, one.state]),
			[[keep, "ok"]],
		);
	});

	it("a disabled host keeps its records: no provider call, the engine skips the paused rows; enabling resumes them", async () => {
		const name = freshName("d");
		const host = hostOf([name]);
		await apply(host, [{ name }]);
		fake.reset();
		const paused = await service.onDisable(manager, { hostType: "proxy_host", host });
		assert.equal(stateOf(paused, name).state, "paused");
		const row = await rowOf(name);
		assert.equal(row.enabled, 0);
		assert.equal(row.state, "disabled");
		assert.equal((await metaOf(name)).paused_by_host, true);
		assert.deepEqual(fake.get(name, "A").values, [IP4], "the record stays");
		// the address moves: a paused row is never written, forced or not, and Update now refuses it
		net.ipv4 = NEW_IP4;
		await engine.cycle({ force: true, ids: [(await rowOf(name)).id] });
		await assert.rejects(engine.updateRecord(row.id), errs.ValidationError);
		assert.equal(fake.total(), 0);

		const resumed = await service.onEnable(manager, { hostType: "proxy_host", host });
		assert.equal(stateOf(resumed, name).state, "pending");
		assert.equal((await metaOf(name)).paused_by_host, undefined);
		await engine.cycle({ force: true, ids: [(await rowOf(name)).id] });
		assert.deepEqual(fake.get(name, "A").values, [NEW_IP4]);
	});

	it("deleting a host deletes its created records at the provider and releases the adopted ones", async () => {
		const made = freshName("made");
		const taken = freshName("taken");
		fake.set(taken, "A", [IP4]);
		const host = hostOf([made, taken]);
		await apply(host, [{ name: made }, { name: taken }]);
		fake.reset();
		const answered = await service.onDelete(manager, { hostType: "proxy_host", host });
		assert.deepEqual(
			answered.map((one) => [one.name, one.state]),
			[
				[made, "pending"],
				[taken, "pending"],
			],
		);
		assert.equal(fake.total(), 0, "the delete answers before the provider work");
		await service.idle("proxy_host", host.id);
		assert.deepEqual(await hostStates(host), []);
		assert.deepEqual(fake.removes, [{ name: made, type: "A", value: IP4 }]);
		assert.deepEqual(fake.get(taken, "A").values, [IP4]);
		assert.equal(await rowOf(made), undefined);
		assert.equal(await rowOf(taken), undefined);
	});

	it("a failed delete keeps an orphan the engine never runs; Forget removes only the row", async () => {
		const name = freshName("o");
		const host = hostOf([name]);
		await apply(host, [{ name }]);
		fake.reset();
		fake.fail.remove = true;
		const states = await deleteHost(host);
		assert.equal(states[0].state, "orphan");
		assert.equal(states[0].message, "HTTP 500 at the provider");
		const row = await rowOf(name);
		assert.equal(row.enabled, 0);
		assert.equal(row.state, "failed");
		assert.equal((await metaOf(name)).orphan, true);
		await engine.cycle({ force: true, ids: [(await rowOf(name)).id] });
		assert.equal(fake.calls.write, 0);
		// a second try that fails again keeps it
		const again = await service.removeAtProvider(manager, { id: row.id });
		assert.equal(again.state, "orphan");
		assert.equal(fake.calls.remove, 2);
		// Forget: the normal delete, which removes the row and calls no provider
		const admins = { ...accessOf(), isAdmin: true };
		await internalDdnsRecord.delete(admins, { id: row.id });
		assert.equal(await rowOf(name), undefined);
		assert.equal(fake.calls.remove, 2);
		assert.deepEqual(fake.get(name, "A").values, [IP4]);
	});

	it("an orphan of an IPv4 and IPv6 record keeps only the address still to delete", async () => {
		net.ipv6 = IP6;
		const name = freshName("six");
		const host = hostOf([name]);
		const states = await apply(host, [{ name, ipv6: true }]);
		assert.equal(stateOf(states, name).state, "ok");
		assert.deepEqual(
			fake.writes.map((one) => [one.type, one.ip]),
			[
				["A", IP4],
				["AAAA", IP6],
			],
		);
		fake.reset();
		const remove = provider.remove;
		provider.remove = (args) =>
			args.type === "AAAA"
				? Promise.reject(new DdnsProviderError({ code: "failed", message: "AAAA refused" }))
				: remove(args);
		try {
			await apply(host, []);
		} finally {
			provider.remove = remove;
		}
		const row = await rowOf(name);
		assert.equal(row.last_ipv4, null, "the A record is gone");
		assert.equal(row.last_ipv6, IP6);
		await service.removeAtProvider(manager, { id: row.id });
		assert.deepEqual(fake.removes.at(-1), { name, type: "AAAA", value: IP6 });
		assert.equal(await rowOf(name), undefined);
	});

	it("an AAAA record only with the box and a detected public IPv6", async () => {
		const name = freshName("v4");
		await apply(hostOf([name]), [{ name, ipv6: true }]);
		assert.deepEqual(
			fake.writes.map((one) => one.type),
			["A"],
			"no IPv6 was detected",
		);
		assert.equal((await rowOf(name)).ip_version, "ipv4");
		net.ipv6 = IP6;
		const plain = freshName("v6off");
		await apply(hostOf([plain]), [{ name: plain }]);
		assert.equal((await rowOf(plain)).ip_version, "ipv4", "the box is off by default");
	});
});

describe("checks before a tick", () => {
	it("a host with the option off is never touched: no provider call, probe or detection in any path", async () => {
		const name = freshName("off");
		const host = hostOf([name]);
		for (const wanted of [undefined, []]) {
			assert.deepEqual(await apply(host, wanted), []);
			assert.deepEqual(
				await service.applyHost(manager, {
					hostType: "proxy_host",
					hostBefore: host,
					hostAfter: { ...host, domain_names: [freshName("renamed")] },
					wanted,
				}),
				[],
			);
		}
		assert.deepEqual(await service.onDisable(manager, { hostType: "proxy_host", host }), []);
		assert.deepEqual(await service.onEnable(manager, { hostType: "proxy_host", host }), []);
		assert.deepEqual(await service.onDelete(manager, { hostType: "proxy_host", host }), []);
		assert.deepEqual(await service.statesOf(manager, { hostType: "proxy_host", host }), []);
		assert.equal(fake.total(), 0);
		assert.equal(probe.calls, 0);
		assert.equal(net.asked, 0);
		assert.equal(await rowOf(name), undefined);
	});

	it("only ticked names get a record", async () => {
		const ticked = freshName("yes");
		const others = [freshName("no"), freshName("no")];
		const states = await apply(hostOf([ticked, ...others]), [{ name: ticked }]);
		assert.deepEqual(
			states.map((one) => one.state),
			["ok", "off", "off"],
		);
		assert.deepEqual(
			fake.writes.map((one) => one.name),
			[ticked],
		);
		for (const name of others) assert.equal(await rowOf(name), undefined);
	});

	it("wildcard and regular expression host names are unavailable", async () => {
		const states = await apply(hostOf([`*.w.${ZONE}`, "~^re[0-9]+\\.example\\.com$"]), [
			{ name: `*.w.${ZONE}` },
			{ name: "~^re[0-9]+\\.example\\.com$" },
		]);
		assert.deepEqual(
			states.map((one) => [one.state, one.reason]),
			[
				["unavailable", "error.host-dns-wildcard"],
				["unavailable", "error.host-dns-pattern"],
			],
		);
		assert.equal(fake.total(), 0);
	});

	it("covered by a wildcard at the parent or by a manual record: no row", async () => {
		const parent = `cov.${ZONE}`;
		fake.set(`*.${parent}`, "A", [OTHER]);
		const viaProvider = `x.${parent}`;
		const states = await apply(hostOf([viaProvider]), [{ name: viaProvider }]);
		assert.equal(stateOf(states, viaProvider).state, "covered");
		assert.equal(stateOf(states, viaProvider).covered_by, `*.${parent}`);
		assert.equal(await rowOf(viaProvider), undefined);

		const manual = freshName("manual");
		const made = await admin.post("/nginx/ddns-records", { name: manual, dns_credential_id: credentialId });
		assert.equal(made.status, 201, made.text);
		const manualWildcard = await admin.post("/nginx/ddns-records", {
			name: `*.mw.${ZONE}`,
			dns_credential_id: credentialId,
		});
		assert.equal(manualWildcard.status, 201, manualWildcard.text);
		fake.reset();
		const second = await apply(hostOf([manual, `y.mw.${ZONE}`]), [{ name: manual }, { name: `y.mw.${ZONE}` }]);
		assert.deepEqual(
			second.map((one) => [one.state, one.covered_by, one.reason]),
			[
				["covered", manual, "host-dns.covered-by-record"],
				["covered", `*.mw.${ZONE}`, "host-dns.covered-by-wildcard"],
			],
		);
		assert.equal(fake.calls.write, 0);
	});

	it("two credentials of other owners cover the name: unavailable; the user's own one settles it", async () => {
		const other = await api.limited({ visibility: "user", certificates: "manage" });
		const theirs = await other.post("/nginx/dns-credentials", {
			name: "Theirs",
			provider: "cloudflare",
			fields: [{ key: "dns_cloudflare_api_token", value: "their-token-0123456789" }],
		});
		assert.equal(theirs.status, 201, theirs.text);
		const listed = await other.post("/nginx/dns-domains", { dns_credential_id: theirs.body.id, names: [ZONE] });
		assert.equal(listed.status, 201, listed.text);
		try {
			const name = freshName("two");
			const third = accessOf({ userId: 777 });
			const [plan] = await service.planNames(third, { hostType: "proxy_host", host: hostOf([name]) });
			assert.equal(plan.available, false);
			assert.equal(plan.reason, "error.host-dns-many-credentials");
			const states = await apply(hostOf([name]), [{ name }], third);
			assert.equal(stateOf(states, name).reason, "error.host-dns-many-credentials");
			const [own] = await service.planNames(manager, { hostType: "proxy_host", host: hostOf([name]) });
			assert.equal(own.available, true);
			assert.equal(own.credential.id, credentialId);
			assert.equal(fake.calls.write, 0);
		} finally {
			await other.delete(`/nginx/dns-domains/${listed.body[0]?.id ?? listed.body.id}`);
		}
	});

	it("no public address: unavailable, no probe and no provider call", async () => {
		net.ipv4 = null;
		const name = freshName("noip");
		const states = await apply(hostOf([name]), [{ name, reach_confirmed: true }]);
		assert.equal(stateOf(states, name).reason, "error.host-dns-no-public-address");
		assert.equal(probe.calls, 0);
		assert.equal(fake.total(), 0);
		// a private address is no public one either
		net.ipv4 = "192.168.1.10";
		const [plan] = await service.planNames(manager, { hostType: "proxy_host", host: hostOf([name]) });
		assert.equal(plan.reason, "error.host-dns-no-public-address");
	});

	it("a save never probes: a probe of the last 10 minutes or the confirmation, else unavailable", async () => {
		const name = freshName("reach");
		const host = hostOf([name]);
		const refused = await apply(host, [{ name, reach_confirmed: false }]);
		assert.equal(stateOf(refused, name).state, "unavailable");
		assert.equal(stateOf(refused, name).reason, "error.host-dns-reach-unconfirmed");
		assert.equal(probe.calls, 0, "the save did not probe");
		assert.equal(fake.total(), 0);
		assert.equal(await rowOf(name), undefined);

		// the window's probe could not confirm it: still refused without the box, accepted with it
		probe.result = "could-not-confirm";
		const probed = await service.reach(manager, { hostType: "proxy_host", host, name });
		assert.equal(probed.result, "could-not-confirm");
		assert.equal(probed.address, IP4);
		const again = await apply(host, [{ name, reach_confirmed: false }]);
		assert.equal(stateOf(again, name).reach.result, "could-not-confirm");
		const states = await apply(host, [{ name, reach_confirmed: true }]);
		assert.equal(stateOf(states, name).state, "ok");
		const meta = await metaOf(name);
		assert.equal(meta.reach.result, "could-not-confirm");
		assert.equal(meta.reach.confirmed, true);
		assert.equal(probe.calls, 1);

		// a proof counts for 10 minutes, then the save needs the box again
		probe.result = "reachable";
		const later = freshName("later");
		const laterHost = hostOf([later]);
		await service.reach(manager, { hostType: "proxy_host", host: laterHost, name: later });
		clock.at += 11 * 60_000;
		const old = await apply(laterHost, [{ name: later, reach_confirmed: false }]);
		assert.equal(stateOf(old, later).reason, "error.host-dns-reach-unconfirmed");
		assert.equal(probe.calls, 2);
	});

	it("a save answers before any provider work: pending, then the job's result", async () => {
		const name = freshName("now");
		const dropped = freshName("gone");
		const host = hostOf([name, dropped]);
		await apply(host, [{ name: dropped }]);
		fake.reset();
		const answered = await service.applyHost(manager, {
			hostType: "proxy_host",
			hostBefore: host,
			hostAfter: host,
			wanted: [{ name, reach_confirmed: true }],
		});
		assert.deepEqual(
			answered.map((one) => [one.name, one.state]),
			[
				[name, "pending"],
				[dropped, "pending"],
			],
		);
		assert.equal(fake.total(), 0, "no provider call inside the save");
		assert.equal(probe.calls, 0, "no probe inside the save");
		await service.idle("proxy_host", host.id);
		assert.deepEqual(
			(await hostStates(host)).map((one) => [one.name, one.state]),
			[
				[name, "ok"],
				[dropped, "off"],
			],
		);
		assert.deepEqual(fake.removes, [{ name: dropped, type: "A", value: IP4 }]);
	});

	it("a host's jobs run one after another", async () => {
		const name = freshName("serial");
		const host = hostOf([name]);
		const order = [];
		const write = provider.write;
		provider.write = async (args) => {
			order.push("write");
			return await write(args);
		};
		const remove = provider.remove;
		provider.remove = async (args) => {
			order.push("remove");
			return await remove(args);
		};
		try {
			await service.applyHost(manager, {
				hostType: "proxy_host",
				hostAfter: host,
				wanted: confirmedTicks([{ name }]),
			});
			await service.applyHost(manager, { hostType: "proxy_host", hostAfter: host, wanted: [] });
			await service.idle("proxy_host", host.id);
		} finally {
			provider.write = write;
			provider.remove = remove;
		}
		assert.deepEqual(order, ["write", "remove"]);
		assert.equal(await rowOf(name), undefined);
	});

	it("the reach probe takes plain names and the host type's manage right", async () => {
		await assert.rejects(
			service.reach(manager, { hostType: "proxy_host", host: null, name: `*.${ZONE}` }),
			errs.ValidationError,
		);
		await assert.rejects(
			service.reach(accessOf({ hosts: "view" }), { hostType: "proxy_host", host: null, name: `r.${ZONE}` }),
			errs.PermissionError,
		);
		assert.equal(probe.calls, 0);
	});

	it("Proxied is sent only by the create, only for a Cloudflare credential's tick with the box", async () => {
		const name = freshName("px");
		const host = hostOf([name]);
		await apply(host, [{ name, proxied: true }]);
		assert.deepEqual(fake.writes, [{ name, type: "A", ip: IP4, ttl: 300, create: true, proxied: true }]);
		// a later write of a new address does not send it
		net.ipv4 = NEW_IP4;
		await engine.cycle({ force: true, ids: [(await rowOf(name)).id] });
		const update = fake.writes.find((one) => one.name === name && !one.create);
		assert.equal(update.proxied, undefined);
		assert.equal(update.ip, NEW_IP4);

		// the real Cloudflare create: proxied (TTL automatic) only with the flag, never in a PATCH
		const { default: cloudflare } = await import("../lib/ddns/providers/cloudflare.js");
		const bodies = [];
		const fetch = (_url, options) => {
			bodies.push({ method: options?.method ?? "GET", body: options?.body ? JSON.parse(options.body) : null });
			return Promise.resolve({ status: 200, json: { success: true, result: { id: "a".repeat(32) } } });
		};
		const base = {
			zone: ZONE,
			name,
			type: "A",
			ip: IP4,
			fields: { dns_cloudflare_api_token: "t0123456789" },
			fetch,
		};
		await cloudflare.write({
			...base,
			ttl: 300,
			existing: null,
			meta: { zone_id: HEX_ZONE, proxied_on_create: true },
		});
		await cloudflare.write({ ...base, ttl: 300, existing: null, meta: { zone_id: HEX_ZONE } });
		await cloudflare.write({
			...base,
			ttl: 300,
			existing: { values: [OTHER], meta: { record_id: "b".repeat(32) } },
			meta: { zone_id: HEX_ZONE, proxied_on_create: true, record_id: "b".repeat(32) },
		});
		assert.deepEqual(
			bodies.map((one) => one.body),
			[
				{ type: "A", name, content: IP4, ttl: 1, proxied: true },
				{ type: "A", name, content: IP4, ttl: 300, proxied: false },
				{ content: IP4, ttl: 300 },
			],
		);
	});

	it("a new record's TTL is 300 raised to the provider's minimum", async () => {
		provider.minTtl = 3600;
		const name = freshName("ttl");
		await apply(hostOf([name]), [{ name }]);
		assert.equal((await rowOf(name)).ttl, 3600);
		assert.equal(fake.writes[0].ttl, 3600);
	});

	it("a tick needs certificates:manage; an untick needs the host's right only", async () => {
		const name = freshName("right");
		const host = hostOf([name]);
		const viewer = accessOf({ certificates: "view" });
		const states = await apply(host, [{ name }], viewer);
		assert.equal(stateOf(states, name).reason, "error.host-dns-no-right");
		assert.equal(fake.total(), 0);
		assert.equal(net.asked, 0);
		await apply(host, [{ name }]);
		fake.reset();
		await apply(host, [], accessOf({ certificates: "hidden" }));
		assert.equal(fake.calls.remove, 1);
		assert.equal(await rowOf(name), undefined);
	});

	it("another owner's credential: not offered to a user who cannot see it, and shown as managed by another user", async () => {
		const name = freshName("own");
		const host = hostOf([name]);
		const stranger = accessOf({ userId: 55, visibility: "user" });
		const states = await apply(host, [{ name }], stranger);
		assert.equal(stateOf(states, name).reason, "error.host-dns-no-credential");
		await apply(host, [{ name }]);
		const seen = await service.statesOf(stranger, { hostType: "proxy_host", host });
		assert.equal(stateOf(seen, name).reason, "host-dns.other-owner");
		assert.equal(stateOf(seen, name).message, "Managed by another user");
	});

	it("a disabled host gets no new record", async () => {
		const name = freshName("dis");
		const states = await apply(hostOf([name], { enabled: false }), [{ name }]);
		assert.equal(stateOf(states, name).reason, "error.host-dns-host-disabled");
		assert.equal(fake.total(), 0);
	});

	it("a name another host's record keeps is unavailable", async () => {
		const name = freshName("shared");
		await apply(hostOf([name]), [{ name }]);
		const states = await apply(hostOf([name]), [{ name }]);
		assert.equal(stateOf(states, name).reason, "error.host-dns-name-taken");
	});
});

describe("a host's records in the Dynamic DNS list", () => {
	it("are read-only through the record routes, show their host, and an orphan may be forgotten", async () => {
		const name = freshName("ro");
		const host = await realHost([name]);
		await apply(host, [{ name }]);
		const row = await rowOf(name);
		const listed = await admin.get(`/nginx/ddns-records/${row.id}`);
		assert.equal(listed.status, 200, listed.text);
		assert.equal(listed.body.host_type, "proxy_host");
		assert.equal(listed.body.host_id, host.id);
		assert.equal(listed.body.origin, "created");
		assert.equal(listed.body.host_label, name);
		assert.equal(listed.body.orphan, false);
		const all = await admin.get("/nginx/ddns-records");
		assert.equal(all.body.find((one) => one.id === row.id).host_label, name);

		const put = await admin.put(`/nginx/ddns-records/${row.id}`, { enabled: false });
		assert.equal(put.status, 400, put.text);
		assert.equal(put.body.error.message_i18n, "error.ddns-managed-by-host");
		const deleted = await admin.delete(`/nginx/ddns-records/${row.id}`);
		assert.equal(deleted.status, 400, deleted.text);
		assert.equal(deleted.body.error.message_i18n, "error.ddns-managed-by-host");
		assert.ok(await rowOf(name));
		await assert.rejects(
			internalDdnsRecord.removeAtProvider(manager, { id: row.id }),
			(error) => error instanceof errs.ValidationError,
		);
	});
});

describe("never over or under another client's record", () => {
	const auditOf = (action, name) =>
		api
			.db("audit_log")
			.where({ object_type: "ddns-record", action })
			.then((rows) => rows.map((row) => JSON.parse(row.meta)).filter((meta) => meta.name === name));

	for (const [label, value] of [
		["another address", OTHER],
		["the wanted address", IP4],
	]) {
		it(`a record with ${label} that appears between the read and the write: exists, nothing written`, async () => {
			const name = freshName("gap");
			const host = hostOf([name]);
			const racing = makeService({
				writeRecord: (id) => {
					fake.set(name, "A", [value]);
					return runEngine(id);
				},
			});
			await racing.applyHost(manager, {
				hostType: "proxy_host",
				hostAfter: host,
				wanted: confirmedTicks([{ name }]),
			});
			await racing.idle("proxy_host", host.id);
			const line = stateOf(await racing.statesOf(manager, { hostType: "proxy_host", host }), name);
			assert.equal(line.state, "exists");
			assert.equal(line.origin, null);
			assert.equal(line.adopt_allowed, true);
			assert.deepEqual(line.found, [{ type: "A", values: [value] }]);
			assert.equal(fake.calls.write, 0);
			// releasing it calls no provider: NPMpro created nothing
			await apply(host, []);
			assert.equal(fake.calls.remove, 0);
			assert.deepEqual(fake.get(name, "A").values, [value]);
		});
	}

	it("a failed create retried after a record appeared: exists, the record is not written over", async () => {
		const name = freshName("retry");
		const host = hostOf([name]);
		fake.fail.write = true;
		assert.equal(stateOf(await apply(host, [{ name }]), name).state, "failed");
		assert.equal((await metaOf(name)).create_only, true);
		fake.fail.write = false;
		fake.set(name, "A", [OTHER]);
		const writes = fake.calls.write;
		await engine.cycle({ force: true, ids: [(await rowOf(name)).id] });
		assert.equal(fake.calls.write, writes);
		const line = stateOf(await hostStates(host), name);
		assert.equal(line.state, "exists");
		assert.deepEqual(fake.get(name, "A").values, [OTHER]);
		assert.equal((await rowOf(name)).enabled, 0);
	});

	it("the first successful write ends create-only: later runs keep the record like any other", async () => {
		const name = freshName("once");
		await apply(hostOf([name]), [{ name }]);
		assert.equal((await metaOf(name)).create_only, undefined);
		fake.set(name, "A", [OTHER]);
		await engine.cycle({ force: true, ids: [(await rowOf(name)).id] });
		assert.deepEqual(fake.get(name, "A").values, [IP4], "the engine put its address back");
	});

	it("an A and AAAA row deletes each family with its own value; another value at the provider makes an orphan", async () => {
		net.ipv6 = IP6;
		const name = freshName("fam");
		const host = hostOf([name]);
		const line = stateOf(await apply(host, [{ name, ipv6: true }]), name);
		assert.equal(line.ipv6, true);
		// a record id stored for one family is never handed to the other's delete
		const row = await rowOf(name);
		const meta = { ...JSON.parse(row.meta), record_id: fake.get(name, "AAAA").id };
		await api
			.db("npmpro_ddns_record")
			.where({ id: row.id })
			.update({ meta: JSON.stringify(meta) });
		await apply(host, []);
		assert.deepEqual(fake.removes, [
			{ name, type: "A", value: IP4 },
			{ name, type: "AAAA", value: IP6 },
		]);
		assert.equal(fake.get(name, "A"), null);
		assert.equal(fake.get(name, "AAAA"), null);
		assert.equal(await rowOf(name), undefined);
		assert.deepEqual((await auditOf("removed", name))[0].results, [
			{ type: "A", value: IP4, outcome: "gone" },
			{ type: "AAAA", value: IP6, outcome: "gone" },
		]);

		// someone changed the A at the provider: it stays there, the row stays as an orphan with a note
		const changed = freshName("chg");
		const other = hostOf([changed]);
		await apply(other, [{ name: changed }]);
		fake.set(changed, "A", [OTHER]);
		const states = await apply(other, []);
		assert.equal(stateOf(states, changed).state, "orphan");
		assert.deepEqual(fake.get(changed, "A").values, [OTHER]);
		assert.equal((await metaOf(changed)).orphan_note, "changed");
		assert.deepEqual((await auditOf("orphaned", changed))[0].results, [
			{ type: "A", value: IP4, outcome: "changed" },
		]);
	});

	it("a set present for one family only is exists, not adopted", async () => {
		net.ipv6 = IP6;
		const name = freshName("half");
		fake.set(name, "A", [IP4]);
		const line = stateOf(await apply(hostOf([name]), [{ name, ipv6: true }]), name);
		assert.equal(line.state, "exists");
		assert.equal(line.adopt_allowed, true);
		assert.deepEqual(line.found, [{ type: "A", values: [IP4] }]);
		assert.equal(fake.calls.write, 0);
	});

	it("a provider read the shared reader skipped (429) is failed; nothing is made", async () => {
		const name = freshName("busy");
		fake.fail.read429 = true;
		const line = stateOf(await apply(hostOf([name]), [{ name }]), name);
		assert.equal(line.state, "failed");
		assert.equal(line.reason, "error.host-dns-read-skipped");
		assert.equal(await rowOf(name), undefined);
		assert.equal(fake.calls.write, 0);
	});

	it("another owner's covering record is not named", async () => {
		const name = freshName("hidden");
		const owner = await api.limited({ visibility: "user", certificates: "manage" });
		await api.db("npmpro_ddns_record").insert({
			owner_user_id: owner.user.id,
			dns_credential_id: null,
			provider: "custom",
			name,
			zone: "",
			kind: "address",
			ip_version: "ipv4",
			enabled: true,
			state: "pending",
			failures: 0,
			created_on: "2026-11-25 10:00:00",
			modified_on: "2026-11-25 10:00:00",
		});
		const own = accessOf({ visibility: "user" });
		const [plan] = await service.planNames(own, { hostType: "proxy_host", host: hostOf([name]) });
		assert.equal(plan.reason, "host-dns.covered-by-other");
		assert.equal(plan.covered_by, null);
		assert.equal(plan.message, "Covered by another record");
		const [seen] = await service.planNames(manager, { hostType: "proxy_host", host: hostOf([name]) });
		assert.equal(seen.covered_by, name);
	});
});

describe("a host delete and the host's job", () => {
	const save = (host, wanted) =>
		service.applyHost(manager, { hostType: "proxy_host", hostAfter: host, wanted: confirmedTicks(wanted) });
	const remove = (host) => {
		gone.add(host.id);
		return service.onDelete(manager, { hostType: "proxy_host", host });
	};

	it("a delete while the save job reads: the record is never made", async () => {
		const name = freshName("del");
		const host = hostOf([name]);
		const held = hold("read");
		await save(host, [{ name }]);
		await held.started;
		assert.deepEqual(await remove(host), []);
		held.open();
		await settle(host);
		assert.equal(fake.calls.write, 0);
		assert.equal(await rowOf(name), undefined);
		assert.equal(fake.get(name, "A"), null);
	});

	it("a delete while the save job writes: the record made is removed by the delete job", async () => {
		const name = freshName("delw");
		const host = hostOf([name]);
		const held = hold("write");
		await save(host, [{ name }]);
		await held.started;
		await remove(host);
		held.open();
		await settle(host);
		assert.equal(fake.calls.write, 1);
		assert.deepEqual(fake.removes, [{ name, type: "A", value: IP4 }]);
		assert.equal(fake.get(name, "A"), null);
		assert.equal(await rowOf(name), undefined);
	});

	it("a delete queued behind a save job: the save job finds the host gone and calls no provider", async () => {
		const name = freshName("delq");
		const host = hostOf([name]);
		await save(host, [{ name }]);
		await remove(host);
		await settle(host);
		assert.equal(fake.total(), 0);
		assert.equal(await rowOf(name), undefined);
	});

	it("a delete of a host with rows and a running job releases every row, also the one the job was making", async () => {
		const kept = freshName("rows");
		const added = freshName("added");
		const host = hostOf([kept, added]);
		await apply(host, [{ name: kept }]);
		fake.reset();
		const held = hold("read", (args) => args.name === added);
		await save(host, [{ name: kept }, { name: added }]);
		await held.started;
		const answered = await remove(host);
		assert.deepEqual(
			answered.map((one) => [one.name, one.state]),
			[[kept, "pending"]],
		);
		held.open();
		await settle(host);
		assert.deepEqual(fake.removes, [{ name: kept, type: "A", value: IP4 }]);
		assert.equal(fake.calls.write, 0);
		assert.equal(await rowOf(kept), undefined);
		assert.equal(await rowOf(added), undefined);
	});

	it("the engine knows its own record: A written, AAAA failed, the retry continues; untick deletes both", async () => {
		net.ipv6 = IP6;
		const name = freshName("own6");
		const host = hostOf([name]);
		const write = provider.write;
		provider.write = (args) =>
			args.type === "AAAA"
				? Promise.reject(new DdnsProviderError({ code: "failed", message: "AAAA refused" }))
				: write(args);
		try {
			assert.equal(stateOf(await apply(host, [{ name, ipv6: true }]), name).state, "failed");
		} finally {
			provider.write = write;
		}
		assert.equal((await metaOf(name)).create_only, true);
		assert.deepEqual(fake.get(name, "A").values, [IP4]);
		await engine.cycle({ force: true, ids: [(await rowOf(name)).id] });
		const line = stateOf(await hostStates(host), name);
		assert.equal(line.state, "ok");
		assert.equal(line.origin, "created");
		assert.deepEqual(fake.get(name, "AAAA").values, [IP6]);
		await apply(host, []);
		assert.equal(fake.get(name, "A"), null);
		assert.equal(fake.get(name, "AAAA"), null);
		assert.equal(await rowOf(name), undefined);
	});
});

describe("record safety: deletes, re-ticks, disables, restores and the routes' limits", () => {
	const save = (host, wanted, access = manager) =>
		service.applyHost(access, { hostType: "proxy_host", hostAfter: host, wanted: confirmedTicks(wanted) });
	const tickOnce = () => new Promise((resolve) => setTimeout(resolve, 30));

	it("a row whose host is gone at start becomes an orphan; nothing is deleted at the provider until asked", async () => {
		const made = freshName("sweep");
		const taken = freshName("sweepa");
		fake.set(taken, "A", [IP4]);
		const host = hostOf([made, taken]);
		await apply(host, [{ name: made }, { name: taken }]);
		assert.equal((await rowOf(taken)).origin, "adopted");
		fake.reset();
		// a restart while the delete's job waited: the host row is gone, the job never ran
		gone.add(host.id);
		assert.ok((await service.orphanHostless()) >= 2);
		for (const name of [made, taken]) {
			const row = await rowOf(name);
			assert.equal(row.enabled, 0);
			assert.equal((await metaOf(name)).orphan, true);
			assert.equal((await metaOf(name)).orphan_note, "host-gone");
		}
		assert.equal(fake.total(), 0);
		assert.equal(await service.orphanHostless(), 0, "an orphan is not counted again");
		// Delete at the provider again: the created record goes; the adopted one's row goes, its record stays
		await service.removeAtProvider(manager, { id: (await rowOf(made)).id });
		assert.deepEqual(fake.removes, [{ name: made, type: "A", value: IP4 }]);
		await service.removeAtProvider(manager, { id: (await rowOf(taken)).id });
		assert.equal(fake.calls.remove, 1);
		assert.deepEqual(fake.get(taken, "A").values, [IP4]);
		assert.equal(await rowOf(made), undefined);
		assert.equal(await rowOf(taken), undefined);
	});

	it("a host delete: a row whose release throws becomes an orphan and the other rows are still released", async () => {
		const first = freshName("thr");
		const second = freshName("thr");
		const host = hostOf([first, second]);
		await apply(host, [{ name: first }, { name: second }]);
		fake.reset();
		const firstId = (await rowOf(first)).id;
		const remove = managedRows.remove;
		managedRows.remove = (id) => (id === firstId ? Promise.reject(new Error("database is locked")) : remove(id));
		try {
			await deleteHost(host);
		} finally {
			managedRows.remove = remove;
		}
		assert.equal((await metaOf(first)).orphan, true);
		assert.equal((await rowOf(first)).enabled, 0);
		assert.equal(await rowOf(second), undefined);
		assert.equal(fake.calls.remove, 2);
	});

	it("a save with a new tick and no known address makes no detection in the request; the job detects", async () => {
		net.unknown = true;
		const name = freshName("det");
		const host = hostOf([name]);
		const answered = await save(host, [{ name }]);
		assert.equal(stateOf(answered, name).state, "pending");
		assert.equal(net.asked, 0, "no detection inside the save");
		await settle(host);
		assert.ok(net.asked > 0, "the job detected");
		assert.equal(stateOf(await hostStates(host), name).state, "ok");
		// no address at all: the job refuses the name
		net.ipv4 = null;
		const none = freshName("det");
		const noneHost = hostOf([none]);
		assert.equal(stateOf(await save(noneHost, [{ name: none }]), none).state, "pending");
		await settle(noneHost);
		assert.equal(stateOf(await hostStates(noneHost), none).reason, "error.host-dns-no-public-address");
		assert.equal(fake.calls.write, 1);
	});

	it("a changed orphan ticked again resumes create-only: the other value ends as exists and is never written over", async () => {
		const name = freshName("chg");
		const host = hostOf([name]);
		await apply(host, [{ name }]);
		// someone else replaced the record at the provider
		fake.set(name, "A", [OTHER]);
		fake.reset();
		assert.equal(stateOf(await apply(host, []), name).state, "orphan");
		assert.equal((await metaOf(name)).orphan_note, "changed");
		fake.reset();
		const again = stateOf(await apply(host, [{ name }]), name);
		assert.equal(again.state, "exists");
		assert.equal(again.adopt_allowed, true);
		assert.equal(fake.calls.write, 0);
		assert.deepEqual(fake.get(name, "A").values, [OTHER]);

		// an orphan whose record is still NPMpro's resumes as its own: nothing is written, it is ok
		const own = freshName("res");
		const ownHost = hostOf([own]);
		await apply(ownHost, [{ name: own }]);
		fake.fail.remove = true;
		assert.equal(stateOf(await apply(ownHost, []), own).state, "orphan");
		fake.reset();
		assert.equal(stateOf(await apply(ownHost, [{ name: own }]), own).state, "ok");
		assert.equal(fake.calls.write, 0);
		assert.equal((await metaOf(own)).create_only, undefined, "its first run ended create-only");
	});

	it("an orphan of another owner's credential is not resumed by a user who cannot see it", async () => {
		const name = freshName("oth");
		const host = hostOf([name]);
		await apply(host, [{ name }]);
		fake.fail.remove = true;
		await apply(host, []);
		fake.reset();
		const stranger = accessOf({ userId: 55, visibility: "user" });
		const states = await apply(host, [{ name }], stranger);
		assert.equal(stateOf(states, name).state, "unavailable");
		assert.equal(stateOf(states, name).reason, "error.host-dns-no-credential");
		assert.equal((await metaOf(name)).orphan, true);
		assert.equal(fake.total(), 0);
	});

	it("a host disabled while its save job runs gets its row paused; enabling it writes the record", async () => {
		const name = freshName("dj");
		const host = hostOf([name]);
		const held = hold("read");
		await save(host, [{ name }]);
		await held.started;
		disabledHosts.add(host.id);
		assert.deepEqual(await service.onDisable(manager, { hostType: "proxy_host", host }), []);
		held.open();
		await settle(host);
		const row = await rowOf(name);
		assert.equal(row.enabled, 0);
		assert.equal(row.state, "disabled");
		assert.equal((await metaOf(name)).paused_by_host, true);
		assert.equal(fake.calls.write, 0);
		disabledHosts.delete(host.id);
		await service.onEnable(manager, { hostType: "proxy_host", host });
		await runEngine(row.id);
		assert.deepEqual(fake.get(name, "A").values, [IP4]);
	});

	it("Adopt and update on a disabled host adopts the row paused and writes nothing", async () => {
		const name = freshName("ad");
		fake.set(name, "A", [OTHER]);
		const host = await realHost([name]);
		const line = stateOf(await apply(host, [{ name }]), name);
		assert.equal(line.state, "exists");
		await api.db("proxy_host").where({ id: host.id }).update({ enabled: false });
		fake.reset();
		const adopted = await service.adopt(manager, { id: line.record_id });
		assert.equal(adopted.state, "paused");
		assert.equal(adopted.origin, "adopted");
		assert.equal((await metaOf(name)).paused_by_host, true);
		assert.equal(fake.calls.write, 0);
		assert.deepEqual(fake.get(name, "A").values, [OTHER]);
	});

	it("Adopt and Leave on a row removed while they waited for its lock answer 404", async () => {
		for (const action of ["adopt", "leave"]) {
			const name = freshName(action);
			fake.set(name, "A", [OTHER]);
			const host = await realHost([name]);
			const line = stateOf(await apply(host, [{ name }]), name);
			let release;
			const gate = new Promise((resolve) => {
				release = resolve;
			});
			const holding = recordLock(line.record_id, () => gate);
			const pending = service[action](manager, { id: line.record_id });
			await tickOnce();
			await api.db("npmpro_ddns_record").where({ id: line.record_id }).delete();
			release();
			await holding;
			await assert.rejects(pending, errs.ItemNotFoundError);
		}
	});

	it("a job result is shown to another user with own visibility without its provider message or covering name", async () => {
		const parent = `mask.${ZONE}`;
		fake.set(`*.${parent}`, "A", [OTHER]);
		const covered = `x.${parent}`;
		const failing = freshName("mskf");
		const host = hostOf([covered, failing]);
		const read = provider.read;
		provider.read = (args) =>
			args.name === failing
				? Promise.reject(new DdnsProviderError({ code: "failed", message: "HTTP 500 zone 42 detail" }))
				: read(args);
		let own;
		try {
			own = await apply(host, [{ name: covered }, { name: failing }]);
		} finally {
			provider.read = read;
		}
		assert.equal(stateOf(own, covered).covered_by, `*.${parent}`);
		assert.match(stateOf(own, failing).message, ZONE_DETAIL);
		const owner = accessOf({ userId: 55, visibility: "user" });
		const seen = await service.statesOf(owner, { hostType: "proxy_host", host });
		assert.deepEqual(
			[stateOf(seen, covered).state, stateOf(seen, covered).reason, stateOf(seen, covered).covered_by],
			["covered", "host-dns.covered-by-other", null],
		);
		assert.equal(stateOf(seen, failing).state, "failed");
		assert.equal(stateOf(seen, failing).reason, "error.host-dns-read-failed");
		assert.equal(stateOf(seen, failing).message, "The record could not be read at the provider");
	});

	it("a host job waits while a restore pauses Dynamic DNS, and leaves a row a restore put at the same id", async () => {
		const name = freshName("pz");
		const host = hostOf([name]);
		ddnsPause.on = true;
		await save(host, [{ name }]);
		await tickOnce();
		assert.equal(fake.total(), 0);
		assert.equal(await rowOf(name), undefined);
		ddnsPause.on = false;
		await settle(host);
		assert.equal(stateOf(await hostStates(host), name).state, "ok");

		// the first release waits at the provider; meanwhile the second row's id holds another host's row
		const other = freshName("pz");
		const both = hostOf([name, other]);
		const twoHost = { ...host, domain_names: [name, other] };
		await apply(twoHost, [{ name }, { name: other }]);
		fake.reset();
		const otherId = (await rowOf(other)).id;
		const held = hold("remove");
		await save(twoHost, []);
		await held.started;
		await api.db("npmpro_ddns_record").where({ id: otherId }).update({ host_id: both.id });
		held.open();
		await settle(twoHost);
		assert.deepEqual(fake.removes, [{ name, type: "A", value: IP4 }]);
		assert.equal((await rowOf(other)).host_id, both.id, "the row at that id is left alone");
		assert.deepEqual(fake.get(other, "A").values, [IP4]);
	});

	it("a credential deleted between the plan and the insert: no credential, not name taken", async () => {
		const name = freshName("nocred");
		const insert = managedRows.insert;
		managedRows.insert = () => Promise.reject(new errs.ItemNotFoundError(credentialId));
		let states;
		try {
			states = await apply(hostOf([name]), [{ name }]);
		} finally {
			managedRows.insert = insert;
		}
		assert.equal(stateOf(states, name).reason, "error.host-dns-no-credential");
	});

	it("the reach probe: at most 4 at once, and a repeat of the last 30 s is answered without probing", async () => {
		let active = 0;
		let most = 0;
		const gates = [];
		const limited = makeService({
			probe: async () => {
				active += 1;
				most = Math.max(most, active);
				await new Promise((resolve) => gates.push(resolve));
				active -= 1;
				return { result: "reachable", port: 80, detail: "" };
			},
		});
		const names = Array.from({ length: 6 }, () => freshName("lim"));
		const all = names.map((one) => limited.reach(manager, { hostType: "proxy_host", host: null, name: one }));
		while (gates.length < 4) await tickOnce();
		await tickOnce();
		assert.equal(gates.length, 4, "the fifth waits");
		while (gates.length > 0 || active > 0) {
			for (const open of gates.splice(0)) open();
			await tickOnce();
		}
		await Promise.all(all);
		assert.equal(most, 4);

		const name = freshName("rep");
		await service.reach(manager, { hostType: "proxy_host", host: null, name });
		await service.reach(manager, { hostType: "proxy_host", host: null, name });
		assert.equal(probe.calls, 1);
		clock.at += 31_000;
		await service.reach(manager, { hostType: "proxy_host", host: null, name });
		assert.equal(probe.calls, 2);
	});

	it("the plan route reuses its answer for 30 s for the same user and names; a host change forgets it", async () => {
		const name = freshName("pc");
		const plan = () => service.planHost(manager, { hostType: "proxy_host", names: [name] });
		const first = await plan();
		const reads = fake.calls.read;
		assert.ok(reads > 0);
		assert.deepEqual(await plan(), first);
		assert.equal(fake.calls.read, reads, "answered again from the last 30 s");
		await service.planHost(accessOf({ userId: 2 }), { hostType: "proxy_host", names: [name] });
		assert.ok(fake.calls.read > reads, "another user is planned on its own");
		const afterOther = fake.calls.read;
		clock.at += 31_000;
		await plan();
		assert.ok(fake.calls.read > afterOther, "an answer older than 30 s is planned again");
		assert.equal((await plan()).names[0].available, true);
		// another host takes the name: the plan is made again at once
		await apply(hostOf([name]), [{ name }]);
		assert.equal((await plan()).names[0].reason, "error.host-dns-name-taken");
	});
});
