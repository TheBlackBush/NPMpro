import { updateGeoip } from "./update.js";

let inFlight = null;

/**
 * Updates the databases with the configured credentials, records the outcome and reloads the readers
 * when any file was replaced (`ok` means every requested edition succeeded, `updated` can be non-empty without it).
 * Concurrent calls share the run that is already in progress.
 *
 * @param   {Object}    options
 * @param   {Object}    options.geoip           createGeoip() instance
 * @param   {string}    options.dir
 * @param   {Function}  options.recordResult    ({ ok, error, updated }) => Promise
 * @param   {Function}  options.getConfig
 * @param   {Function}  [options.update]
 * @returns {Promise<{ok: boolean, updated: string[], error?: string}>}
 */
const runConfiguredGeoipUpdate = (options) => {
	if (inFlight) return inFlight;
	inFlight = runOnce(options).finally(() => {
		inFlight = null;
	});
	return inFlight;
};

const runOnce = async ({ geoip, dir, recordResult, getConfig, update = updateGeoip }) => {
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
		if (result.updated.length > 0) await geoip.reload();
	}
	return result;
};

export { runConfiguredGeoipUpdate };
