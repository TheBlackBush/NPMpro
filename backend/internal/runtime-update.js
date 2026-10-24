import errs from "../lib/error.js";
import { acmeServerOf, appliesOf, isRuntimeGroup, mergeRuntimeConfig, rulesOf } from "../lib/runtime-rules.js";
import { global as logger } from "../logger.js";
import { createSerializer, pickEditable } from "./monitoring-update.js";

/**
 * GET/PUT response of a runtime settings group
 *
 * @param   {string}  group
 * @param   {{values: Object, locked: string[]}}  cfg
 * @returns {Object}
 */
const runtimeView = (group, cfg) => ({ ...cfg.values, locked: cfg.locked, applies: appliesOf(group) });

/**
 * Builds the runtime settings update. All groups share one queue: each update (read stored, validate, apply, save)
 * runs as one unit.
 *
 * @param   {Object}    deps
 * @param   {Function}  deps.readStored          (group) => stored meta
 * @param   {Function}  deps.saveStored          (group, meta) => void
 * @param   {Function}  deps.getApply            () => apply(group, nextValues, prevValues, options), read on every
 *                                               update; runs before the save, a throw saves nothing and is
 *                                               rethrown; when the save fails it runs again with the values swapped
 *                                               and { revert: true }, so the files match the stored values
 * @param   {Function}  [deps.findCertificate]   (id) => { id, provider } | undefined
 * @param   {Function}  [deps.onSaved]           (group, { values, locked }) => void, after the save with the merged
 *                                               values (cache refresh)
 * @param   {Object}    [deps.env]
 * @param   {Object}    [deps.opts]              passed to mergeRuntimeConfig
 * @param   {Object}    [deps.log]
 * @returns {(group: string, body: Object) => Promise<{meta: Object, values: Object, locked: string[]}>}
 */
const createRuntimeUpdater = ({
	readStored,
	saveStored,
	getApply,
	findCertificate = async (id) => ({ id, provider: "letsencrypt" }),
	onSaved = () => {},
	env,
	opts,
	log = logger,
}) => {
	const serialize = createSerializer();
	const envOf = () => env ?? process.env;

	const update = async (group, body) => {
		if (!isRuntimeGroup(group)) throw new errs.ItemNotFoundError(group);
		const rules = rulesOf(group);
		const stored = (await readStored(group)) ?? {};
		const prev = mergeRuntimeConfig(group, stored, envOf(), opts);
		const changes = pickEditable(
			body ?? {},
			prev.locked,
			rules.map((rule) => rule.key),
		);
		if (Object.keys(changes).length === 0) return { meta: stored, values: prev.values, locked: prev.locked };

		// validated against the values the group will have, so key_size is checked against the new key_type
		const draft = mergeRuntimeConfig(group, { ...stored, ...changes }, envOf(), opts).values;
		const target = { ...draft, ...changes };
		for (const rule of rules) {
			if (!(rule.key in changes)) continue;
			const message = rule.validate(changes[rule.key], target);
			if (message !== null) throw new errs.ValidationError(`${rule.key}: ${message}`);
		}
		const certId = changes.default_certificate_id;
		if (Number.isInteger(certId) && certId !== 0) {
			const certificate = await findCertificate(certId);
			if (!certificate) throw new errs.ValidationError("default_certificate_id: Certificate not found");
			// an mTLS CA certificate verifies clients, it has no key to serve
			if (certificate.provider === "mtls") {
				throw new errs.ValidationError(
					"default_certificate_id: an mTLS CA certificate cannot be the default certificate",
				);
			}
		}

		const meta = { ...stored, ...changes };
		// a stored value the change made invalid (key_size after a key_type change) falls back to its default
		for (const rule of rules) {
			if (rule.key in meta && !(rule.key in changes) && rule.validate(meta[rule.key], target) !== null) {
				delete meta[rule.key];
			}
		}
		// internal: the ACME server a non-empty profile was checked against (the merge ignores it for another server)
		if (group === "certificates" && "profile" in changes) {
			if (changes.profile) meta.profile_server = acmeServerOf(envOf());
			else delete meta.profile_server;
		}
		const next = mergeRuntimeConfig(group, meta, envOf(), opts);

		const apply = getApply();
		await apply(group, next.values, prev.values);
		try {
			await saveStored(group, meta);
		} catch (err) {
			try {
				await apply(group, prev.values, next.values, { revert: true });
			} catch (revertErr) {
				log.error(
					`Could not apply the ${group} runtime settings back after a failed save: ${revertErr.message}`,
				);
			}
			throw err;
		}
		onSaved(group, { values: next.values, locked: next.locked });
		return { meta, values: next.values, locked: next.locked };
	};

	const run = (group, body) => serialize(() => update(group, body));
	// runs fn in the same queue, so a check (certificate delete guard) cannot interleave with a save
	run.exclusive = (fn) => serialize(fn);
	return run;
};

export { createRuntimeUpdater, runtimeView };
