import errs from "../error.js";
import { createKeyedLock } from "../keyed-lock.js";
import { scrubSecrets } from "./errors.js";
import { canonicalIpv6, withSuffix } from "./ipv6.js";
import { providerFetch } from "./provider-fetch.js";
import { plainTarget } from "./providers/record-common.js";

const HISTORY_LIMIT = 50;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;
const NO_ADDRESS_ERRORS = new Set(["error.ddns-ip-failed", "error.ddns-ip-disagree", "error.ddns-ip-unconfirmed"]);

/** A failure the engine itself reports (not a provider answer); key and values travel in the record's meta */
class EngineFailure extends Error {
	constructor(message, key, values) {
		super(message);
		this.key = key;
		this.values = values;
	}
}

const toMs = (value) => {
	if (value === null || value === undefined) return null;
	const ms = value instanceof Date ? value.getTime() : Date.parse(value);
	return Number.isNaN(ms) ? null : ms;
};

const defaultMakeFetch = (secrets) => (url, options) => providerFetch(url, { ...options, secrets });

const familyOf = (record) => {
	const version = record.ip_version ?? "ipv4";
	if (version === "both") return [4, 6];
	return version === "ipv6" ? [6] : [4];
};

const typeOf = (family) => (family === 6 ? "AAAA" : "A");

// compares two spellings of one value: an IPv6 address by number, a CNAME target without case and trailing dot
const same = (type, left, right) => {
	if (type === "CNAME") return plainTarget(left) === plainTarget(right);
	if (type === "AAAA") return canonicalIpv6(String(left)) === canonicalIpv6(String(right));
	return String(left) === String(right);
};

// the stored meta without the last engine error (a new run sets its own)
const cleanMeta = (meta) => {
	const { error_i18n: _key, error_values: _values, ...rest } = meta ?? {};
	return rest;
};

// what a provider is handed to look a record up: the record id belongs to one record type, so it is not passed on
const lookupMeta = (meta) => {
	const { record_id: _ignored, ...rest } = cleanMeta(meta);
	return rest;
};

/**
 * The dynamic DNS engine: one cycle over the due records, one record at a time under its lock.
 *
 * @param   {Object}    deps
 * @param   {Object}    deps.store         enabledRecords(), getRecord(id), saveRecord(id, patch), addHistory(id, row),
 *                                         trimHistory(id, keep), openCredential(record) -> { fields, secrets }
 * @param   {Object}    deps.publicIp      createPublicIp's { detect(family) }
 * @param   {Object}    deps.providers     { providerById(id) } (read and write per provider)
 * @param   {Function}  deps.resolveName   (name, type, servers) -> String[] | null
 * @param   {Function}  deps.settings      () -> { periodMs, cooldownMs, resolvers }
 * @param   {Object}    [deps.clock]       { now() } in ms
 * @param   {Object}    [deps.log]         { error(), info() }
 * @param   {Function} [deps.recordLock]   (id, fn) one run at a time per record
 * @param   {Function} [deps.makeFetch]    (secrets) -> the guarded fetch handed to a provider
 * @param   {Function} [deps.runNow]       (fn) runs fn under the timer's lock (Update now)
 */
const createDdnsEngine = ({
	store,
	publicIp,
	providers,
	resolveName,
	settings,
	clock = { now: () => Date.now() },
	log,
	recordLock = createKeyedLock(),
	makeFetch = defaultMakeFetch,
	runNow = (fn) => fn(),
}) => {
	const now = () => clock.now();
	const isDue = (record) => {
		const next = toMs(record.next_try_on);
		return next === null || next <= now();
	};

	// written after the record patch is saved: a history error is logged and never loses the patch
	const writeHistory = async (id, rows) => {
		for (const row of rows) {
			try {
				await store.addHistory(id, row);
				await store.trimHistory(id, HISTORY_LIMIT);
			} catch (err) {
				log?.error(`Dynamic DNS: the history of record ${id} was not written: ${err?.message}`);
			}
		}
	};

	/** A public address the records may be written from: confirmed, with no error of the last detection */
	const detectFamilies = async (records) => {
		const wanted = new Set();
		for (const record of records)
			if (record.kind !== "alias") for (const family of familyOf(record)) wanted.add(family);
		const found = new Map();
		for (const family of [4, 6]) {
			if (!wanted.has(family)) continue;
			try {
				found.set(family, await publicIp.detect(family));
			} catch (err) {
				log?.error(`Dynamic DNS: the IPv${family} detection failed: ${err?.message}`);
				found.set(family, { address: null, error_i18n: "error.ddns-ip-failed" });
			}
		}
		return found;
	};

	const confirmed = (state) =>
		Boolean(state?.address) && !(state.error_i18n && NO_ADDRESS_ERRORS.has(state.error_i18n));

	/** The units a record keeps in line: [{ type, family, wanted }], or null when an address is not known */
	const unitsOf = (record, found) => {
		if (record.kind === "alias") return [{ type: "CNAME", family: null, wanted: record.target }];
		const units = [];
		for (const family of familyOf(record)) {
			const state = found.get(family);
			if (!confirmed(state)) return null;
			let wanted = state.address;
			if (family === 6 && record.ipv6_suffix) {
				try {
					wanted = withSuffix(state.address, record.ipv6_suffix);
				} catch {
					throw new EngineFailure(
						`The IPv6 suffix ${record.ipv6_suffix} is not valid; edit the record`,
						"error.ddns-bad-suffix",
						{ suffix: record.ipv6_suffix },
					);
				}
			}
			units.push({ type: typeOf(family), family, wanted });
		}
		return units;
	};

	const readOther = async (ctx, types) => {
		for (const type of types) {
			const found = await ctx.provider.read({
				zone: ctx.record.zone,
				name: ctx.record.name,
				type,
				fields: ctx.cred.fields,
				fetch: ctx.fetch,
				meta: lookupMeta(ctx.meta),
			});
			if (found !== null) return type;
		}
		return null;
	};

	const checkOtherType = async (ctx, unit) => {
		if (unit.type === "CNAME") {
			if ((await readOther(ctx, ["A", "AAAA"])) !== null) {
				throw new EngineFailure(
					"The name has an address record; remove it or use an address record",
					"error.ddns-name-has-address",
				);
			}
		} else if ((await readOther(ctx, ["CNAME"])) !== null) {
			throw new EngineFailure(
				"The name has a CNAME record; remove it or use an alias record",
				"error.ddns-name-has-cname",
			);
		}
	};

	/** Brings one record type in line. Returns { outcome, change?, waitUntil? } or throws */
	const runUnit = async (ctx, unit) => {
		const { record } = ctx;
		const base = {
			zone: record.zone,
			name: record.name,
			type: unit.type,
			fields: ctx.cred.fields,
			fetch: ctx.fetch,
		};
		// a proxied record resolves to the proxy, so only the provider's answer tells its value
		if (unit.type !== "CNAME" && ctx.meta.proxied !== true) {
			const answer = await resolveName(record.name, unit.type, settings().resolvers ?? []);
			if (Array.isArray(answer) && answer.length === 1 && same(unit.type, answer[0], unit.wanted)) {
				return { outcome: "uptodate" };
			}
		}
		const existing = await ctx.provider.read({ ...base, meta: lookupMeta(ctx.meta) });
		if (existing === null) {
			await checkOtherType(ctx, unit);
			const written = await ctx.provider.write({
				...base,
				ip: unit.wanted,
				ttl: record.ttl ?? undefined,
				existing: null,
				meta: lookupMeta(ctx.meta),
			});
			ctx.meta = { ...ctx.meta, ...written?.meta };
			return { outcome: "created", change: { kind: "created", old: null, new: unit.wanted } };
		}
		const count = existing.values?.length ?? 0;
		if (count > 1) {
			throw new EngineFailure(
				`The record has ${count} addresses; NPMpro updates single-address records only`,
				"error.ddns-multi-value",
				{ count },
			);
		}
		ctx.meta = { ...ctx.meta, ...existing.meta };
		if (same(unit.type, existing.values?.[0], unit.wanted)) return { outcome: "uptodate" };
		const lastWrite = toMs(record.last_changed_on);
		const { cooldownMs } = settings();
		if (lastWrite !== null && lastWrite + cooldownMs > now()) {
			const waitUntil = lastWrite + cooldownMs;
			if (ctx.strictCooldown) {
				throw Object.assign(
					new errs.ValidationError(
						"The record was written recently; the next write is allowed later",
						"error.ddns-cooldown",
						{ values: { next_write_on: new Date(waitUntil).toISOString() } },
					),
					{ cooldown: true },
				);
			}
			return { outcome: "waiting", waitUntil };
		}
		const written = await ctx.provider.write({
			...base,
			ip: unit.wanted,
			ttl: record.ttl ?? undefined,
			existing,
			meta: { ...lookupMeta(ctx.meta), record_id: existing.meta?.record_id },
		});
		ctx.meta = { ...ctx.meta, ...written?.meta };
		return { outcome: "changed", change: { kind: "changed", old: existing.values?.[0] ?? null, new: unit.wanted } };
	};

	const failurePatch = (record, err, secrets, { countTry }) => {
		const failures = (record.failures ?? 0) + (countTry ? 1 : 0);
		const delay = Math.min(settings().periodMs * 2 ** Math.max(failures - 1, 0), MAX_BACKOFF_MS);
		const meta = cleanMeta(record.meta);
		const patch = {
			state: "failed",
			error: scrubSecrets(err?.message, secrets),
			last_checked_on: new Date(now()),
		};
		if (err instanceof EngineFailure) {
			meta.error_i18n = err.key;
			if (err.values) meta.error_values = err.values;
		}
		patch.meta = meta;
		if (countTry) {
			patch.failures = failures;
			patch.next_try_on = new Date(now() + delay);
		}
		return patch;
	};

	/** Runs one record (under its lock): { skipped } when it is gone, disabled or has no address, else the outcome */
	const processRecord = (id, found, { ignoreDue, strictCooldown, countTry }) =>
		recordLock(id, async () => {
			const record = await store.getRecord(id);
			if (!record || record.enabled === false) return { skipped: "record" };
			if (!ignoreDue && !isDue(record)) return { skipped: "due" };

			let secrets = [];
			const done = [];
			let waitUntil = null;
			const ctx = { record, meta: { ...record.meta }, strictCooldown };
			try {
				const units = unitsOf(record, found);
				if (units === null) return { skipped: "address" };
				ctx.cred = await store.openCredential(record);
				secrets = ctx.cred.secrets ?? [];
				ctx.provider = providers.providerById(record.provider);
				if (!ctx.provider) throw new Error("The provider is not available");
				ctx.fetch = makeFetch(secrets);
				for (const unit of units) {
					const result = await runUnit(ctx, unit);
					done.push({ unit, result });
					if (result.outcome === "waiting") waitUntil = Math.max(waitUntil ?? 0, result.waitUntil);
				}
			} catch (err) {
				if (err?.cooldown) {
					const partial = { last_checked_on: new Date(now()) };
					const rows = changesOf(done, partial);
					await store.saveRecord(id, partial);
					await writeHistory(id, rows);
					throw err;
				}
				const patch = failurePatch(record, err, secrets, { countTry });
				const rows = changesOf(done, patch);
				if (record.state !== "failed") rows.push({ kind: "failed", message: patch.error });
				await store.saveRecord(id, patch);
				await writeHistory(id, rows);
				return { failed: true };
			}

			const patch = { last_checked_on: new Date(now()) };
			patch.meta = lookupMeta(ctx.meta);
			const rows = changesOf(done, patch);
			if (waitUntil === null) {
				Object.assign(patch, { state: "ok", failures: 0, next_try_on: null, error: null });
				if (record.state === "failed") rows.push({ kind: "recovered" });
			} else {
				// the state and the error stay as they were, so the error's key stays with its text
				const { error_i18n: key, error_values: values } = record.meta ?? {};
				if (key !== undefined) patch.meta.error_i18n = key;
				if (values !== undefined) patch.meta.error_values = values;
				patch.next_try_on = new Date(waitUntil);
			}
			await store.saveRecord(id, patch);
			await writeHistory(id, rows);
			return { ok: true };
		});

	/** The history rows of the changes made, and the addresses now known and the change time, into the patch */
	const changesOf = (done, patch) => {
		const rows = [];
		for (const { unit, result } of done) {
			if (result.outcome === "waiting") continue;
			if (unit.family !== null) patch[unit.family === 6 ? "last_ipv6" : "last_ipv4"] = unit.wanted;
			if (!result.change) continue;
			patch.last_changed_on = new Date(now());
			rows.push({
				kind: result.change.kind,
				ip_version: unit.family === null ? null : `ipv${unit.family}`,
				old_ip: result.change.old,
				new_ip: result.change.new,
			});
		}
		return rows;
	};

	const safeProcess = async (id, found, options) => {
		try {
			await processRecord(id, found, options);
		} catch (err) {
			log?.error(`Dynamic DNS: record ${id} failed: ${err?.message}`);
		}
	};

	return {
		/**
		 * One cycle over the enabled records that are due (all of them with force)
		 *
		 * @param   {{ force?: boolean, ids?: number[] }} [options]  ids: only these records (Check now of a user)
		 * @returns {Promise<{ ran: boolean }>}
		 */
		cycle: async ({ force = false, ids } = {}) => {
			const enabled = (await store.enabledRecords()).filter(
				(record) => ids === undefined || ids.includes(record.id),
			);
			if (enabled.length === 0) return { ran: false };
			const due = force ? enabled : enabled.filter(isDue);
			const found = await detectFamilies(due);
			for (const record of due) {
				await safeProcess(record.id, found, { ignoreDue: force, strictCooldown: false, countTry: true });
			}
			return { ran: true };
		},

		/**
		 * Update now: runs the record at once, ignoring next_try_on and not counting as a scheduled try; the cooldown
		 * holds (a 400 with error.ddns-cooldown and message_values.next_write_on)
		 *
		 * @param   {number} id
		 * @returns {Promise<Object>} the record
		 */
		updateRecord: (id) =>
			runNow(async () => {
				const record = await store.getRecord(id);
				if (!record) throw new errs.ItemNotFoundError(id);
				if (record.enabled === false) {
					throw new errs.ValidationError(
						"The record is disabled; enable it first",
						"error.ddns-record-disabled",
					);
				}
				const found = await detectFamilies([record]);
				const result = await processRecord(id, found, {
					ignoreDue: true,
					strictCooldown: true,
					countTry: false,
				});
				if (result.skipped === "address") {
					const unknown = [...found.values()].filter((one) => !confirmed(one));
					const state = unknown.find((one) => one.error_i18n) ?? unknown[0];
					throw new errs.ValidationError(
						state?.error ?? "The public address is not known yet; try again after the next check",
						state?.error_i18n ?? "error.ddns-ip-failed",
					);
				}
				return store.getRecord(id);
			}),
	};
};

export { createDdnsEngine, HISTORY_LIMIT };
