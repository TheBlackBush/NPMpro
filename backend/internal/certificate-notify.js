import dayjs from "dayjs";
import { certificateFile } from "../lib/certificate-files.js";
import { credentialFields, secretValuesOf } from "../lib/dns-credential-values.js";
import { expiryState, toDate } from "../lib/expiry.js";
import { ssl as logger } from "../logger.js";
import certificateModel from "../models/certificate.js";
import dnsCredentialModel from "../models/dns_credential.js";
import certificateInfo from "./certificate-info.js";
import internalDnsCredential from "./dns-credential.js";
import { notify } from "./notify.js";

// The notification emit points of certificates: the expiry state, the renewal failure state and the renewed action.
// Nothing here throws into the certificate code: a failure is logged and the certificate action keeps its result.

const EXPIRING = "certificate.expiring";
const RENEWAL_FAILED = "certificate.renewal_failed";
const DAY_MS = 24 * 60 * 60 * 1000;
const ACCOUNT_PATH = /\S*\/accounts\/\S*/gu;

const guarded = async (what, work) => {
	try {
		return await work();
	} catch (error) {
		logger.warn(`Certificate notifications: ${what} failed: ${String(error?.message ?? error).slice(0, 200)}`);
	}
};

/**
 * Stores the valid-from date of a row that has none, read from its certificate file; a failure leaves the row as it is
 *
 * @param {Object} row  a certificate row, changed in place
 */
const fillValidFrom = async (row) => {
	if (row.npmpro_valid_from) return;
	try {
		const info = await certificateInfo.getCertificateInfoFromFile(certificateFile(row));
		const from = dayjs.unix(info.dates.from).format("YYYY-MM-DD HH:mm:ss");
		await certificateModel.query().where("id", row.id).patch({ npmpro_valid_from: from });
		row.npmpro_valid_from = from;
	} catch {
		// no readable file: the row keeps the warning days alone
	}
};

/**
 * Reports the expiry state of every certificate but mTLS ones (the hourly sweep and the end of every renewal run)
 *
 * @returns {Promise<void>}
 */
const checkCertificateExpiry = () =>
	guarded("the expiry check", async () => {
		const now = new Date();
		for (const row of await certificateModel.query().whereNot("provider", "mtls")) {
			await fillValidFrom(row);
			const daysLeft = Math.floor((toDate(row.expires_on).getTime() - now.getTime()) / DAY_MS);
			await notify.reportState(EXPIRING, String(row.id), {
				state: expiryState(row, now),
				source: { ...row, days_left: daysLeft },
			});
		}
	});

/**
 * Before a renewal run: the Let's Encrypt certificates and the ids of the ones in the warning window or expired
 *
 * @returns {Promise<{rows: Object[], due: Set<number>}>}
 */
const snapshotBeforeRenewal = async () =>
	(await guarded("the due list", async () => {
		const rows = await certificateModel.query().where("provider", "letsencrypt");
		const now = new Date();
		return { rows, due: new Set(rows.filter((row) => expiryState(row, now) !== "ok").map((row) => row.id)) };
	})) ?? { rows: [], due: new Set() };

// the values of the DNS credentials of the due certificates, so no error text carries one
const secretsOf = async (rows) => {
	const secrets = [];
	for (const id of new Set(rows.map((row) => row.npmpro_dns_credential_id).filter(Boolean))) {
		const credential = await dnsCredentialModel.query().findById(id);
		if (!credential) continue;
		const fields = credentialFields(internalDnsCredential.openValues(credential));
		secrets.push(...secretValuesOf(credential.provider, fields));
	}
	return secrets;
};

/**
 * After a renewal run and the refresh of the expiry dates: renewal failure states and renewed events
 *
 * @param {Object}   run
 * @param {Object[]} run.rows       the rows before the run
 * @param {Set}      run.due        ids that were soon or expired before the run
 * @param {Object[]} run.refreshed  { id, expires_on, npmpro_valid_from } of every certificate whose dates were read again
 * @param {?string}  run.error      the certbot text of the run, null when certbot exited 0
 */
const reportRenewalRun = ({ rows, due, refreshed, error }) =>
	guarded("the renewal report", async () => {
		const now = new Date();
		const dates = new Map(refreshed.map((one) => [one.id, one]));
		const bad = [];
		for (const row of rows) {
			const current = { ...row, ...dates.get(row.id) };
			const stillDue = due.has(row.id) && expiryState(current, now) !== "ok";
			if (stillDue) bad.push(current);
			else await notify.reportState(RENEWAL_FAILED, String(row.id), { state: "ok", source: current });
			if (toDate(current.expires_on).getTime() > toDate(row.expires_on).getTime()) {
				await notify.emit("certificate.renewed", current);
			}
		}
		if (bad.length === 0) return;
		const secrets = await guarded("the credential values", () => secretsOf(bad));
		const text = error === null ? null : String(error).replace(ACCOUNT_PATH, "***");
		for (const current of bad) {
			await notify.reportState(RENEWAL_FAILED, String(current.id), {
				state: "bad",
				source: {
					...current,
					error: text ?? "The renewal did not move the expiry date",
					secrets: secrets ?? [],
				},
			});
		}
	});

/**
 * A single renew or re-issue that moved the expiry later
 *
 * @param {Object} before  the row before
 * @param {Object} after   the row after
 */
const emitRenewedWhenLater = (before, after) =>
	guarded("the renewed event", async () => {
		if (toDate(after.expires_on).getTime() > toDate(before.expires_on).getTime()) {
			await notify.emit("certificate.renewed", after);
		}
	});

/** A deleted certificate has no states left */
const clearCertificateStates = (id) =>
	guarded("clearing the states", async () => {
		await notify.clearState(EXPIRING, String(id));
		await notify.clearState(RENEWAL_FAILED, String(id));
	});

export {
	checkCertificateExpiry,
	clearCertificateStates,
	emitRenewedWhenLater,
	reportRenewalRun,
	snapshotBeforeRenewal,
};
