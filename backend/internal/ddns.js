import { createDdnsEngine } from "../lib/ddns/engine.js";
import { providerFetch } from "../lib/ddns/provider-fetch.js";
import { PROVIDER_LIST, providerById } from "../lib/ddns/providers/index.js";
import { createPublicIp, DEFAULT_IPV4_SERVICES, DEFAULT_IPV6_SERVICES } from "../lib/ddns/public-ip.js";
import { resolveName } from "../lib/ddns/resolve-name.js";
import { createDdnsTimer } from "../lib/ddns-timer.js";
import errs from "../lib/error.js";
import { global as logger } from "../logger.js";
import internalAuditLog from "./audit-log.js";
import internalDdnsRecord, { ddnsStore, recordLock } from "./ddns-record.js";

// The dynamic DNS service: the public IP detector, the engine and the timer, built on first use. The status and
// the actions of the API (Check now, Update now) and the pause a restore or a database move takes.

const MINUTE_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const WHITESPACE = /\s+/u;

// The spec's defaults, with the service lists from the environment. The Dynamic DNS runtime settings (Task 5.9)
// replace this function with the rules' values; nothing else here changes.
const ddnsSettings = () => {
	const list = (name, fallback) => {
		const words = String(process.env[name] ?? "")
			.split(WHITESPACE)
			.filter(Boolean);
		return words.length > 0 ? words : fallback;
	};
	return {
		periodMs: 5 * MINUTE_MS,
		cooldownMs: 5 * MINUTE_MS,
		resolvers: [],
		ipv4Services: list("DDNS_IPV4_SERVICES", DEFAULT_IPV4_SERVICES),
		ipv6Services: list("DDNS_IPV6_SERVICES", DEFAULT_IPV6_SERVICES),
	};
};

const fetchEcho = async (url, family) => {
	const res = await providerFetch(url, { family, timeoutMs: FETCH_TIMEOUT_MS });
	if (res.status !== 200) throw new Error(`The service answered HTTP ${res.status}`);
	return res.text;
};

let parts = null;

const build = () => {
	const settings = ddnsSettings;
	const publicIp = createPublicIp({
		fetchText: fetchEcho,
		services: () => ({ ipv4: settings().ipv4Services, ipv6: settings().ipv6Services }),
		log: (message) => logger.warn(`Dynamic DNS: ${message}`),
	});
	let engine = null;
	const timer = createDdnsTimer({
		run: () => engine.cycle(),
		periodMs: settings().periodMs,
		// a pause looks at the running cycle every second; the tests look every 20 ms
		pollMs: process.env.NPMPRO_TEST_ROOT ? 20 : undefined,
		log: logger,
	});
	engine = createDdnsEngine({
		store: ddnsStore,
		publicIp,
		providers: { providerById },
		resolveName,
		settings,
		log: logger,
		recordLock,
		runNow: timer.runNow,
	});
	return { publicIp, timer, engine };
};

const service = () => {
	parts ??= build();
	return parts;
};

const stateOf = (state) => ({
	address: state.address,
	service: state.service,
	checked_on: state.checked_on,
	error: state.error,
	error_i18n: state.error_i18n,
});

const audit = (access, action, row, extra = {}) =>
	internalAuditLog.add(access, {
		action,
		object_type: "ddns-record",
		object_id: row.id,
		meta: { name: row.name, provider: row.provider, dns_credential_id: row.dns_credential_id, ...extra },
	});

/** Starts the timer; the first cycle runs a minute later */
const initDdnsTimer = () => service().timer.start();

/** Pauses the cycles and waits for a running one (a restore or a database move); options: { timeoutMs } */
const pauseDdns = (options) => service().timer.pauseAndWait(options);

const resumeDdns = () => service().timer.resume();

/**
 * @param   {Access}  access
 * @returns {Promise<Object>}  the public address of each family, the next run, whether it is paused or running, and
 *                             the number of enabled records the user can see
 */
const ddnsStatus = async (access) => {
	access.can("certificates:view");
	const { publicIp, timer } = service();
	const next = timer.nextRunOn();
	return {
		ipv4: stateOf(publicIp.state(4)),
		ipv6: stateOf(publicIp.state(6)),
		next_run_on: next === null ? null : new Date(next).toISOString(),
		paused: timer.paused(),
		running: timer.busy(),
		records: await internalDdnsRecord.countEnabled(access),
	};
};

/** Detects the public address again and runs one cycle now over every enabled record (the cooldown holds) */
const checkNow = async (access) => {
	access.can("certificates:manage");
	const { engine, timer } = service();
	const ids = await internalDdnsRecord.enabledIds(access);
	await timer.runNow(() => engine.cycle({ force: true, ids }));
	return await ddnsStatus(access);
};

/** Update now: this record at once; the answer is the record, a failed run included */
const updateNow = async (access, id) => {
	access.can("certificates:manage");
	const row = await internalDdnsRecord.rowOf(access, id, { expand: ["credential"] });
	if (!row.enabled) {
		throw new errs.ValidationError("The record is disabled; enable it first", "error.ddns-record-disabled");
	}
	await service().engine.updateRecord(id);
	await audit(access, "updated", row, { update_now: true, credential_name: row.credential?.name });
	return await internalDdnsRecord.get(access, { id, expand: ["credential"] });
};

const providers = (access) => {
	access.can("certificates:view");
	return PROVIDER_LIST;
};

export { checkNow, ddnsStatus, initDdnsTimer, pauseDdns, providers, resumeDdns, updateNow };
