import { effectiveEnv, getRuntimeConfig } from "../lib/runtime-config.js";
import { createStaplingRecovery } from "../lib/stapling-recovery.js";
import certificateModel from "../models/certificate.js";
import internalNginx from "./nginx.js";
import { HOST_TYPES } from "./runtime-hosts.js";
import { runtimeExclusive } from "./runtime-queue.js";

// re-renders the configs whose OCSP response arrived after they were written (lib/stapling-recovery.js)
const staplingRecovery = createStaplingRecovery({
	hostTypes: HOST_TYPES,
	getConfigName: internalNginx.getConfigName,
	renderConfig: internalNginx.renderConfig,
	nginx: { test: internalNginx.test, reload: internalNginx.reload },
	exclusive: runtimeExclusive,
	effectiveEnv: () => effectiveEnv(),
	getConfig: getRuntimeConfig,
	// an mTLS CA certificate cannot serve as the default certificate
	listCertificates: () => certificateModel.query().select("id").whereNot("provider", "mtls"),
});

/**
 * Runs the stapling recovery in the runtime settings queue; never rejects. Called after the startup regeneration,
 * after the renewal run and (not awaited) after each OCSP fetch that brought new .der files.
 *
 * @returns {Promise<string[]>}  the written paths
 */
const recoverStapling = () => staplingRecovery.recover();

/**
 * Starts the recovery after each OCSP fetch that brings new .der files (from then on)
 */
const watchOcspResponses = () => {
	internalNginx.fetchOcsp.onNewResponses(() => {
		void recoverStapling();
	});
};

export { recoverStapling, watchOcspResponses };
