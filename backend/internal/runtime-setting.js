import errs from "../lib/error.js";
import { getRuntimeConfig, prime } from "../lib/runtime-config.js";
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

const findCertificate = (id) => certificateModel.query().findById(id).select("id", "provider");

const updateRuntimeStored = createRuntimeUpdater({
	readStored,
	saveStored,
	getApply: () => applyHook,
	findCertificate,
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
		const { meta } = await updateRuntimeStored(group, body);
		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "setting",
			meta: { id: group, ...meta },
		});
		return viewOf(group, await getRuntimeConfig(group));
	},
};

export { applyAllRuntime, setRuntimeApply, setRuntimeApplyAll };
export default internalRuntimeSetting;
