import { domainToASCII, domainToUnicode } from "node:url";
import { raw } from "objection";
import { isMysql } from "../lib/config.js";
import errs from "../lib/error.js";
import { castJsonIfNeed } from "../lib/helpers.js";
import deadHostModel from "../models/dead_host.js";
import proxyHostModel from "../models/proxy_host.js";
import redirectionHostModel from "../models/redirection_host.js";
import internalCertificate from "./certificate.js";

// MySQL compares a json column with a binary collation, so LIKE would not ignore case: compare it as text
const domainNamesText = () => (isMysql() ? raw("CAST(?? AS CHAR)", ["domain_names"]) : castJsonIfNeed("domain_names"));

/**
 * @param   {String}  hostname
 * @param   {Array}   existingRows
 * @param   {Integer} [ignoreId]
 * @returns {Boolean}
 */
const checkHostnameRecordsTaken = (hostname, existingRows, ignoreId) =>
	(existingRows || []).some(
		(existingRow) =>
			(!ignoreId || ignoreId !== existingRow.id) &&
			// Does this domain match?
			existingRow.domain_names.some(
				(existingHostname) =>
					(domainToASCII(existingHostname) || existingHostname).toLowerCase() ===
					(domainToASCII(hostname) || hostname).toLowerCase(),
			),
	);

const internalHost = {
	/**
	 * Makes sure that the ssl_* and hsts_* fields play nicely together.
	 * ie: if there is no cert, then force_ssl is off.
	 *     if force_ssl is off, then hsts_enabled is definitely off.
	 *     if hsts_enabled is off, then hsts_subdomains is definitely off.
	 *
	 * @param   {object} data
	 * @param   {object} [existing_data]
	 * @returns {object}
	 */
	cleanSslHstsData: (newCert, data, existingData) => {
		const combinedData = { ...existingData, ...data };

		if (!(combinedData.certificate_id > 0) && !newCert) {
			combinedData.ssl_forced = false;
			combinedData.npmpro_http3_support = false;
			combinedData.npmpro_mtls_certificate_id = 0;
		}

		if (!(combinedData.npmpro_mtls_certificate_id > 0)) {
			combinedData.npmpro_mtls_verify_client_optional = false;
		}

		if (combinedData.npmpro_mtls_certificate_id > 0 && !combinedData.npmpro_mtls_verify_client_optional) {
			combinedData.ssl_forced = true;
		}

		if (!combinedData.ssl_forced) {
			combinedData.hsts_enabled = false;
		}

		if (!combinedData.hsts_enabled) {
			combinedData.hsts_subdomains = false;
		}

		combinedData.npmpro_mtls_bypass_auth_request &&=
			combinedData.npmpro_mtls_certificate_id > 0 &&
			combinedData.npmpro_mtls_verify_client_optional === true &&
			[combinedData, ...(combinedData.locations ?? [])].some(
				({ npmpro_auth_request = "none" }) => npmpro_auth_request !== "none",
			);

		return combinedData;
	},

	/**
	 * Internal use only, checks to see if the domain is already taken by any other record
	 *
	 * @param   {String}   hostname
	 * @param   {String}   [ignore_type]   'proxy', 'redirection', 'dead'
	 * @param   {Integer}  [ignore_id]     Must be supplied if type was also supplied
	 * @returns {Promise}
	 */
	isHostnameTaken: async (hostname, ignore_type, ignore_id) => ({
		hostname,
		is_taken: (
			await Promise.all(
				Object.entries({ proxy: proxyHostModel, redirection: redirectionHostModel, dead: deadHostModel }).map(
					async ([type, model]) =>
						checkHostnameRecordsTaken(
							hostname,
							await model
								.query()
								.where("enabled", 1)
								.andWhere((query) =>
									query
										.whereILike(domainNamesText(), `%${domainToASCII(hostname) || hostname}%`)
										.orWhereILike(domainNamesText(), `%${domainToUnicode(hostname) || hostname}%`),
								),
							ignore_type === type && ignore_id ? ignore_id : 0,
						),
				),
			)
		).includes(true),
	}),

	/**
	 * The certificate step before a save: certificate_id "new" stays for later (a new certificate is only requested
	 * when everything else is valid), a chosen one must fit. Runs before access.can in every host type.
	 *
	 * @param   {Access}  access
	 * @param   {Object}  data  loses certificate_id when it is "new"
	 * @returns {Promise<boolean>}  whether a new certificate is wanted
	 */
	checkCertificates: async (access, data) => {
		const createCertificate = data.certificate_id === "new";
		if (createCertificate) {
			delete data.certificate_id;
		} else if (data.certificate_id > 0) {
			await internalCertificate.get(access, { id: data.certificate_id, mtls: false });
		}
		if (data.npmpro_mtls_certificate_id > 0) {
			await internalCertificate.get(access, { id: data.npmpro_mtls_certificate_id, mtls: true });
		}
		return createCertificate;
	},

	/**
	 * Refuses the first name, in the order given, that another enabled host uses
	 *
	 * @param {String[]}  names
	 * @param {Object}    [options]
	 * @param {String}    [options.ignoreType]  "proxy", "redirection" or "dead"
	 * @param {Number}    [options.ignoreId]
	 * @param {String}    [options.suffix]      added to the message
	 */
	assertHostnamesFree: async (names, { ignoreType, ignoreId, suffix = "" } = {}) => {
		const results = await Promise.all(
			names.map((name) => internalHost.isHostnameTaken(name, ignoreType, ignoreId)),
		);
		const taken = results.find((result) => result.is_taken);
		if (taken) {
			throw new errs.ValidationError(`${taken.hostname} is already in use${suffix}`);
		}
	},

	/**
	 * The report counts of a host model
	 *
	 * @param   {Object}  model
	 * @returns {{getCount: Function, getErrorCount: Function}}
	 */
	hostCounts: (model) => {
		const count = (query, user_id, visibility) => {
			if (visibility !== "all") {
				query.andWhere("owner_user_id", user_id);
			}
			return query.resultSize();
		};
		return {
			getCount: (user_id, visibility) => count(model.query(), user_id, visibility),
			// enabled hosts whose nginx config was rejected
			getErrorCount: (user_id, visibility) =>
				count(model.query().where("enabled", 1).andWhere("npmpro_nginx_online", 0), user_id, visibility),
		};
	},
};

export default internalHost;
