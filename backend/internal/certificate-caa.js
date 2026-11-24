import { presetOf, sameServer } from "../lib/acme-server.js";
import { ddnsSettingsOf } from "../lib/ddns/settings.js";
import { caaIdentitiesOf, checkCaaNames } from "../lib/dns-check/caa-lookup.js";
import { createHostCache } from "../lib/dns-check/host-cache.js";
import { limitConcurrency } from "../lib/dns-check/limit.js";
import { lookup } from "../lib/dns-check/lookup.js";
import errs from "../lib/error.js";
import { effectiveEnv } from "../lib/runtime-config.js";
import { global as logger } from "../logger.js";
import certificateModel from "../models/certificate.js";
import { allowedAcmeServers, instanceServer } from "./acme-account.js";

// The CAA check: do the CAA records of a certificate's names allow the CA that issues it (rules in
// lib/dns-check/caa.js)? Reads only. The results of the ACME certificates are cached in memory for 6 hours, and a
// list call refreshes at most 25 of them, 4 lookups at once.

const CONCURRENCY = 4;
const REFRESH_MS = 6 * 60 * 60 * 1000;
const MAX_REFRESHES = 25;
const CERTIFICATE = "certificate";
const SCOPE = "all";
// worst first: the state of a certificate is the worst state of its names
const SEVERITY = ["refused", "limited", "unknown", "allowed", "not-checked"];
// Let's Encrypt honours the two RFC 8657 parameters; for any other CA they are shown and not compared
const PARAMETER_PRESETS = new Set(["letsencrypt", "letsencrypt-staging"]);

const cache = createHostCache();

const worstOf = (names) => SEVERITY.find((state) => names.some((name) => name.state === state)) ?? "not-checked";

const notChecked = (names, reason, error_i18n) =>
	names.map((name) => ({
		name,
		state: "not-checked",
		reason,
		found_at: null,
		record: null,
		error_i18n,
	}));

/**
 * @param   {Object}  options
 * @param   {String[]}  options.names
 * @param   {String}    options.server
 * @param   {boolean}   options.dnsChallenge
 * @param   {Function}  options.limit
 * @returns {Promise<Array>}  the per-name results
 */
const checkNames = async ({ names, server, dnsChallenge, limit }) => {
	const identities = await caaIdentitiesOf(server);
	if (identities === null) return notChecked(names, "no-identity", "error.caa-no-identity");
	const resolvers = ddnsSettingsOf(effectiveEnv()).resolvers ?? [];
	return await checkCaaNames({
		names,
		identities,
		method: dnsChallenge ? "dns-01" : "http-01",
		parameters: PARAMETER_PRESETS.has(presetOf(server)),
		lookup: (name, type) => limit(() => lookup(name, type, resolvers)),
	});
};

const serverOf = (row) => row.npmpro_acme_server ?? instanceServer();

const entryOf = (row, names, checkedOn) => ({
	certificate_id: row.id,
	state: worstOf(names),
	checked_on: checkedOn,
	names,
});

const visibleCertificates = async (access) => {
	const query = certificateModel.query().where("provider", "letsencrypt").orderBy("id");
	if (access.visibility !== "all") query.andWhere("owner_user_id", access.token.getUserId(1));
	return await query;
};

const internalCertificateCaa = {
	/**
	 * Checks the names for the chosen CA (nothing is cached: the window asks while the user types)
	 *
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @param   {String[]}  data.domain_names  1 to 100 names
	 * @param   {String}    [data.acme_server]  one of the allowed CAs, else the instance CA
	 * @param   {boolean}   [data.dns_challenge]
	 * @returns {Promise<{ checked_on: String, names: Array }>}
	 */
	check: async (access, data) => {
		access.can("certificates:view");
		const wanted = data.acme_server ?? instanceServer();
		const server = (await allowedAcmeServers()).find((allowed) => sameServer(allowed, wanted));
		if (!server) {
			throw new errs.ValidationError(
				"acme_server: an administrator sets this CA up in Settings first",
				"error.acme-ca-not-allowed",
			);
		}
		const names = [...new Set(data.domain_names)];
		const checked = await checkNames({
			names,
			server,
			dnsChallenge: data.dns_challenge === true,
			limit: limitConcurrency(CONCURRENCY),
		});
		return { checked_on: new Date().toISOString(), names: checked };
	},

	/**
	 * The results of the ACME certificates the user may view: cached ones as they are, those older than 6 hours or
	 * missing refreshed (at most 25 per call, the oldest first), the rest `not-checked`
	 *
	 * @param   {Access}  access
	 * @returns {Promise<Array<{ certificate_id: Number, state: String, checked_on: String|null, names: Array }>>}
	 */
	list: async (access) => {
		access.can("certificates:view");
		const rows = await visibleCertificates(access);
		const now = Date.now();
		const stale = rows
			.filter((row) => {
				const entry = cache.get(CERTIFICATE, row.id, SCOPE);
				return entry === undefined || now - entry.at >= REFRESH_MS;
			})
			.sort(
				(a, b) =>
					(cache.get(CERTIFICATE, a.id, SCOPE)?.at ?? 0) - (cache.get(CERTIFICATE, b.id, SCOPE)?.at ?? 0) ||
					a.id - b.id,
			)
			.slice(0, MAX_REFRESHES);
		const limit = limitConcurrency(CONCURRENCY);
		await Promise.all(
			stale.map(async (row) => {
				const since = cache.generation();
				try {
					const names = await checkNames({
						names: [...new Set(row.domain_names)],
						server: serverOf(row),
						dnsChallenge: row.npmpro_dns_challenge === true || row.npmpro_dns_challenge === 1,
						limit,
					});
					cache.set(CERTIFICATE, row.id, SCOPE, { since, names, checked_on: new Date().toISOString() });
				} catch (error) {
					logger.warn(`CAA check: certificate ${row.id} failed: ${error?.message}`);
				}
			}),
		);
		return rows.map((row) => {
			const entry = cache.get(CERTIFICATE, row.id, SCOPE);
			return entry === undefined ? entryOf(row, [], null) : entryOf(row, entry.names, entry.checked_on);
		});
	},

	/** Forgets a certificate's result (it was saved, re-issued, renewed or deleted) */
	clear: (id) => cache.clearHost(CERTIFICATE, id),

	/** Forgets every result (a restore, the renewal run) */
	clearAll: () => cache.clearAll(),
};

export default internalCertificateCaa;
