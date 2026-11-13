import settingModel from "../../models/setting.js";
import { defaultSecretBox } from "../secret-box.js";
import { mergeCrowdsecConfig, SECRET_KEYS } from "./settings.js";

// The crowdsec settings row: meta holds the values (secrets sealed by the secret box) and imported_on. No row means the
// first start after the update: the import of a hand-edited file is still to run (migrations insert no rows).

const CROWDSEC_ID = "crowdsec";

/** @returns {Promise<Object>} the row's meta, {} without a row */
const readStoredCrowdsec = async () => (await settingModel.query().where("id", CROWDSEC_ID).first())?.meta ?? {};

/** @returns {Promise<boolean>} whether the row exists (it does once the first start ran the import) */
const hasStoredCrowdsec = async () => Boolean(await settingModel.query().where("id", CROWDSEC_ID).first());

/** @param {Object} meta */
const saveStoredCrowdsec = async (meta) => {
	if (await settingModel.query().where("id", CROWDSEC_ID).first()) {
		await settingModel.query().where("id", CROWDSEC_ID).patch({ meta });
		return;
	}
	await settingModel
		.query()
		.insert({ id: CROWDSEC_ID, name: "CrowdSec", description: "CrowdSec bouncer", value: CROWDSEC_ID, meta });
};

/**
 * The effective settings of a stored meta: secrets decrypted, env on top. failed names the stored secrets that could
 * not be decrypted (they count as empty); secretError is true when one of them is not set by the environment.
 * values hold the secrets in plain text: callers never return them.
 *
 * @param   {Object} stored
 * @param   {Object} [options]
 * @param   {Object} [options.env]
 * @param   {Object} [options.box]
 * @returns {{ values: Object, locked: string[], invalid: string[], failed: string[], secretError: boolean }}
 */
const effectiveCrowdsec = (stored, { env = process.env, box = defaultSecretBox } = {}) => {
	const plain = { ...stored };
	const failed = [];
	for (const key of SECRET_KEYS) {
		if (typeof stored?.[key] !== "string" || stored[key] === "") continue;
		try {
			plain[key] = String(box.decrypt(stored[key]));
		} catch {
			plain[key] = "";
			failed.push(key);
		}
	}
	const merged = mergeCrowdsecConfig(plain, env);
	return { ...merged, failed, secretError: failed.some((key) => !merged.locked.includes(key)) };
};

/** @returns {Promise<Object>} effectiveCrowdsec of the row, with the row's meta as stored */
const getCrowdsecConfig = async () => {
	const stored = await readStoredCrowdsec();
	return { ...effectiveCrowdsec(stored), stored };
};

export { CROWDSEC_ID, effectiveCrowdsec, getCrowdsecConfig, hasStoredCrowdsec, readStoredCrowdsec, saveStoredCrowdsec };
