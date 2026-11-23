import { SERVICE_KEYS } from "../lib/ddns/settings.js";
import errs from "../lib/error.js";
import { assertAllowedHost } from "../lib/outbound-guard.js";
import { probeResolvers } from "../lib/resolver-probe.js";
import { getRuntimeConfig, invalidate, prime } from "../lib/runtime-config.js";
import { isRuntimeGroup } from "../lib/runtime-rules.js";
import { listTimeZones } from "../lib/time-zones.js";
import certificateModel from "../models/certificate.js";
import settingModel from "../models/setting.js";
import internalAuditLog from "./audit-log.js";
import { runtimeQueue } from "./runtime-queue.js";
import { createRuntimeUpdater, runtimeView, withCpuCount } from "./runtime-update.js";

const NAMES = {
	certificates: "Certificates & TLS",
	network: "Network",
	"forward-auth": "Forward authentication",
	logs: "Logs",
	advanced: "Advanced",
	nginx: "Nginx",
	ddns: "Dynamic DNS",
};

const noApply = async () => {};
let applyHook = noApply;

/**
 * Sets the function that applies a runtime settings change: apply(group, nextValues, prevValues) runs before the
 * save, a throw saves nothing and the error is returned to the client
 *
 * @param {Function} [apply]  without one, changes are only saved
 */
const setRuntimeApply = (apply) => {
	// Inside apply, getRuntimeConfig() still returns the old values: use nextValues or effectiveEnv({ [group]: nextValues })
	applyHook = typeof apply === "function" ? apply : noApply;
};

const noApplyAll = async () => ({});
let applyAllHook = noApplyAll;

/**
 * Sets the function that applies every runtime settings group from the loaded runtime config (after a restore)
 *
 * @param {Function} [applyAll]  () => Promise<{ [group]: Error }>; without one, nothing is applied
 */
const setRuntimeApplyAll = (applyAll) => {
	applyAllHook = typeof applyAll === "function" ? applyAll : noApplyAll;
};

/**
 * Applies every runtime settings group; call loadRuntimeConfig() first so the stored rows are read
 *
 * @returns {Promise<Object>}  { [group]: Error } for the groups that failed
 */
const applyAllRuntime = () => applyAllHook();

const readStored = async (group) => (await settingModel.query().where("id", group).first())?.meta ?? {};

const saveStored = async (group, meta) => {
	const existing = await settingModel.query().where("id", group).first();
	if (existing) {
		await settingModel.query().where("id", group).patch({ meta });
	} else {
		await settingModel
			.query()
			.insert({ id: group, name: NAMES[group], description: NAMES[group], value: group, meta });
	}
};

let resolverProbe = probeResolvers;

/**
 * Sets the function that asks resolver addresses whether they answer (for the API tests)
 *
 * @param {Function} [probe]  (addresses) => Promise<Array<string>> the addresses that did not answer; default: DNS
 */
const setResolverProbe = (probe) => {
	resolverProbe = typeof probe === "function" ? probe : probeResolvers;
};

// the addresses a save added to the resolver list; a probe failure never refuses or fails the save
const resolverWarnings = async (prevValues, values) => {
	const before = prevValues?.resolver_addresses ?? [];
	const added = (values.resolver_addresses ?? []).filter((address) => !before.includes(address));
	if (added.length === 0) return [];
	try {
		const silent = await resolverProbe(added);
		return silent.map((address) => ({
			key: "resolver_addresses",
			address,
			message_i18n: "warning.resolver-no-answer",
		}));
	} catch {
		return [];
	}
};

const findCertificate = (id) => certificateModel.query().findById(id).select("id", "provider");

// Dynamic DNS: a service name that resolves to an address the server may not call is refused on save (a literal
// address is refused by the rule); an unchanged list is never checked, so a stored one is kept
const checkDdnsServices = async (group, changed) => {
	if (group !== "ddns") return;
	for (const key of SERVICE_KEYS) {
		for (const url of changed[key] ?? []) {
			try {
				await assertAllowedHost(url);
			} catch (err) {
				if (err.code !== "EBLOCKED") throw err;
				throw new errs.ValidationError(`${key}: ${err.message}`, "error.ddns-service-blocked");
			}
		}
	}
};

const updateRuntimeStored = createRuntimeUpdater({
	readStored,
	saveStored,
	getApply: () => applyHook,
	findCertificate,
	checkChanges: checkDdnsServices,
	onSaved: (group, cfg) => prime(group, cfg),
	serialize: runtimeQueue,
});

// the advanced view also lists the time zones to pick from, the nginx view the CPU threads
const viewOf = async (group, cfg) => {
	const view = runtimeView(group, cfg);
	if (group === "nginx") return withCpuCount(view);
	return group === "advanced" ? { ...view, time_zones: await listTimeZones() } : view;
};

const assertGroup = (group) => {
	if (!isRuntimeGroup(group)) throw new errs.ItemNotFoundError(group);
};

const internalRuntimeSetting = {
	/**
	 * @param   {Access}  access
	 * @param   {string}  group
	 * @returns {Promise<Object>}  { ...values, locked, applies }
	 */
	getRuntime: async (access, group) => {
		access.canAdmin();
		assertGroup(group);
		return viewOf(group, await getRuntimeConfig(group));
	},

	/**
	 * @param   {Access}  access
	 * @param   {string}  group
	 * @param   {Object}  body  validated against the PUT schema of the group
	 * @returns {Promise<Object>}  the same as getRuntime()
	 */
	updateRuntime: async (access, group, body) => {
		access.canAdmin();
		assertGroup(group);
		const { meta, values, prevValues } = await updateRuntimeStored(group, body);
		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "setting",
			meta: { id: group, ...meta },
		});
		const view = await viewOf(group, await getRuntimeConfig(group));
		if (group !== "nginx" || !prevValues) return view;
		const warnings = await resolverWarnings(prevValues, values);
		return warnings.length > 0 ? { ...view, warnings } : view;
	},
};

/**
 * Applies a group again after something its defaults depend on changed (the instance CA): the cached values are
 * dropped, the group is read again and applied against prevValues, in the runtime settings queue
 *
 * The apply runs with skipCheck: a change the CA drove is never refused for a CA that cannot be asked.
 *
 * @param {string} group
 * @param {Object} prevValues  the values before the change
 */
const reapplyRuntimeGroup = (group, prevValues) =>
	runtimeQueue(async () => {
		invalidate(group);
		const { values } = await getRuntimeConfig(group);
		await applyHook(group, values, prevValues, { skipCheck: true });
	});

export { applyAllRuntime, reapplyRuntimeGroup, setResolverProbe, setRuntimeApply, setRuntimeApplyAll };
export default internalRuntimeSetting;
