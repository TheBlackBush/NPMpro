import { updateGeoip } from "./update.js";

/**
 * Updates the databases with the configured credentials, records the outcome and reloads the readers on success
 *
 * @param   {Object}    options
 * @param   {Object}    options.geoip           createGeoip() instance
 * @param   {string}    options.dir
 * @param   {Function}  options.recordResult    ({ ok, error }) => Promise
 * @param   {Function}  options.getConfig
 * @param   {Function}  [options.update]
 * @returns {Promise<{ok: boolean, updated: string[], error?: string}>}
 */
const runConfiguredGeoipUpdate = async ({ geoip, dir, recordResult, getConfig, update = updateGeoip }) => {
	const { values } = await getConfig();
	if (!values.account_id || !values.license_key) {
		return { ok: false, updated: [], error: "MaxMind account ID and license key are required" };
	}
	const result = await update({
		accountId: values.account_id,
		licenseKey: values.license_key,
		editions: values.editions,
		dir,
		fetch: globalThis.fetch,
	});
	try {
		await recordResult(result);
	} finally {
		if (result.ok) await geoip.reload();
	}
	return result;
};

export { runConfiguredGeoipUpdate };
