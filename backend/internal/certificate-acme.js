import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { domainToASCII } from "node:url";
import dnsPlugins from "../certbot/dns-plugins.json" with { type: "json" };
import { requestOptionsFor } from "../lib/acme-server.js";
import { parseRenewalConf } from "../lib/backup/renewal-conf.js";
import { installPlugin, runCertbot } from "../lib/certbot.js";
import { requestOptionArgs } from "../lib/certbot-account.js";
import { CERTBOT_INI } from "../lib/certbot-ini.js";
import { cleanCertbotMessage, REQUEST_MAX } from "../lib/certbot-message.js";
import { liveCertPath } from "../lib/certificate-files.js";
import errs from "../lib/error.js";
import { rooted } from "../lib/paths.js";
import { getRuntimeConfig } from "../lib/runtime-config.js";
import { ssl as logger } from "../logger.js";
import pjson from "../package.json" with { type: "json" };
import { ensureAccountLocked, instanceServer, withAccountLock, withRenewalLock } from "./acme-account.js";
import internalDnsCredential from "./dns-credential.js";

const renewalConfOf = (id) => rooted(`/data/tls/certbot/renewal/npm-${id}.conf`);
const CERT_FILE = /^cert(?<n>\d*)\.pem$/u;

/** server and account of a certificate's renewal conf, empty when it has none */
const renewalParamsOf = async (id) => {
	try {
		return parseRenewalConf(await readFile(renewalConfOf(id), "utf8")).params;
	} catch {
		return new Map();
	}
};

/**
 * Runs certbot for a request or a renewal; a failure carries the readable message (the CA's sentence and certbot's
 * reason, without its log path and warning blocks) as the error output
 */
const runCertbotCleaned = async (args) => {
	try {
		return await runCertbot(args);
	} catch (err) {
		if (!(err instanceof errs.CommandError)) throw err;
		throw new errs.CommandError(cleanCertbotMessage(err.message, { keepLines: true, max: REQUEST_MAX }), {
			cause: err,
		});
	}
};

/**
 * The CA of a request (the certificate's, else the instance CA), its account (registered lazily) and the options the
 * request passes for that CA (rule 6). certbot gets the spelling of the account's folder (ensureAccountLocked), so it
 * finds the account and the renewal conf it writes names that spelling too.
 *
 * @param   {string}  server  the request's CA
 * @returns {Promise<{server: string, args: string[]}>}
 */
const acmeTarget = async (server, access) => {
	const instance = instanceServer();
	// the caller holds the CA's lock (withAcmeTarget)
	const account = await ensureAccountLocked(server, { access });
	const { values } = await getRuntimeConfig("certificates");
	return {
		server: account.server,
		args: [
			"--server",
			account.server,
			"--account",
			account.accountId,
			...requestOptionArgs(requestOptionsFor(server, instance, values)),
		],
	};
};

/**
 * Runs fn(target) with the CA's account lock held, so a Replace account cannot move or deactivate the account while
 * the certbot run of fn uses it
 */
const withAcmeTarget = (certificate, access, fn) => {
	// the CA is resolved once: the lock and the account are always the same CA's
	const server = certificate.npmpro_acme_server ?? instanceServer();
	return withAccountLock(server, async () => fn(await acmeTarget(server, access)));
};

/** Revokes by the account first, then with the certificate's own key (fact 12); both best effort */
const revokeBestEffort = async ({ server, account, certName, certPath, keyPath, reason }) => {
	const at = server ? ["--server", server] : [];
	const tail = ["--reason", reason, "--no-delete-after-revoke"];
	try {
		const target = certName ? ["--cert-name", certName] : ["--cert-path", certPath];
		logger.info(
			await runCertbot([
				"--config",
				CERTBOT_INI,
				"revoke",
				...at,
				...(account ? ["--account", account] : []),
				...target,
				...tail,
			]),
		);
		return;
	} catch (err) {
		logger.warn(`Revoking through the ACME account failed, trying the certificate's key: ${err.message}`);
	}
	// without a known CA the fallback would go to certbot's default one
	if (!server) return;
	try {
		logger.info(
			await runCertbot([
				"--config",
				CERTBOT_INI,
				"revoke",
				...at,
				"--cert-path",
				certPath,
				"--key-path",
				keyPath,
				...tail,
			]),
		);
	} catch (err) {
		logger.warn(`Could not revoke the certificate: ${err.message}`);
	}
};

/** the certonly of a request through the HTTP challenge, run under the CA's lock by runCertonly */
const certonlyWebroot = (certificate, target, extra) => {
	logger.info(`Requesting Certbot certificates for Cert #${certificate.id}: ${certificate.domain_names.join(", ")}`);

	certificate.domain_names = certificate.domain_names.map((v) => v.replace(/^\[|\]$/gu, ""));
	const { ips = [], domains = [] } = Object.groupBy(certificate.domain_names, (entry) =>
		net.isIP(entry) === 0 ? "domains" : "ips",
	);

	return runCertbotCleaned([
		"--config",
		CERTBOT_INI,
		"certonly",
		...target.args,
		"--cert-name",
		`npm-${certificate.id}`,
		...(domains.length > 0 ? ["--domains", domains.map(domainToASCII).join(",")] : []),
		...ips.flatMap((ip) => ["--ip-address", ip]),
		...(certificate.npmpro_reuse_key ? ["--reuse-key"] : ["--no-reuse-key"]),
		"--authenticator",
		"webroot",
		...extra,
	]);
};

/** the certonly of a request through the DNS challenge, run under the CA's lock by runCertonly */
const certonlyDns = async (certificate, dnsPlugin, target, extra) => {
	await installPlugin(certificate.npmpro_dns_provider);

	logger.info(
		`Requesting Certbot certificates via ${dnsPlugin.name} for Cert #${certificate.id}: ${certificate.domain_names.join(", ")}`,
	);

	const credentialsLocation = rooted(`/tmp/certbot-credentials/credentials-${certificate.id}`);
	await internalDnsCredential.writeCertificateFile(certificate);

	try {
		const result = await runCertbotCleaned([
			"--config",
			CERTBOT_INI,
			"certonly",
			...target.args,
			"--cert-name",
			`npm-${certificate.id}`,
			"--domains",
			certificate.domain_names.map(domainToASCII).join(","),
			...(certificate.npmpro_reuse_key ? ["--reuse-key"] : ["--no-reuse-key"]),
			"--authenticator",
			dnsPlugin.full_plugin_name,
			`--${dnsPlugin.full_plugin_name}-credentials`,
			credentialsLocation,
			...(certificate.npmpro_propagation_seconds > 0
				? [`--${dnsPlugin.full_plugin_name}-propagation-seconds`, certificate.npmpro_propagation_seconds]
				: []),
			...extra,
		]);
		logger.info(result);
		return result;
	} catch (err) {
		await rm(credentialsLocation, { force: true });
		throw err;
	}
};

/**
 * The certonly of a certificate at its CA (the row's, else the instance CA), under that CA's lock with its account
 * ensured: the HTTP or the DNS challenge by the row, extra appended (--force-renewal for a re-issue)
 *
 * @param   {Object}    certificate
 * @param   {Access}    access
 * @param   {Object}    [options]
 * @param   {string[]}  [options.extra]  more certbot arguments
 * @returns {Promise<string>}  certbot's output
 */
const runCertonly = async (certificate, access, { extra = [] } = {}) => {
	if (!certificate.npmpro_dns_challenge) {
		return await withAcmeTarget(certificate, access, (target) => certonlyWebroot(certificate, target, extra));
	}
	const dnsPlugin = dnsPlugins[certificate.npmpro_dns_provider];
	if (!dnsPlugin) {
		throw new errs.ValidationError(`Unknown DNS provider '${certificate.npmpro_dns_provider}'`);
	}
	// the account first (a failed check installs nothing), under the CA's lock for the whole run
	return await withAcmeTarget(certificate, access, (target) => certonlyDns(certificate, dnsPlugin, target, extra));
};

const certificateAcme = {
	/** Requests a certificate through the HTTP challenge */
	requestCertbot: async (certificate, access) => {
		const result = await runCertonly(certificate, access);
		logger.success(result);
		return result;
	},

	requestCertbotWithDnsChallenge: (certificate, access) => runCertonly(certificate, access),

	renewCertbot: async (certificate, access) => {
		const dnsPlugin = certificate.npmpro_dns_challenge ? dnsPlugins[certificate.npmpro_dns_provider] : null;
		if (certificate.npmpro_dns_challenge && !dnsPlugin) {
			throw new errs.ValidationError(`Unknown DNS provider '${certificate.npmpro_dns_provider}'`);
		}

		logger.info(
			`Renewing Certbot certificates ${dnsPlugin ? `via ${dnsPlugin.name} ` : ""}for Cert #${certificate.id}: ${certificate.domain_names.join(", ")}`,
		);

		// under the CA's lock: a Replace account of the CA waits, so the renewal never writes back the old account
		return await withRenewalLock(
			certificate.id,
			async () => {
				const oldCertPath = await realpath(`${liveCertPath(certificate.id)}/cert.pem`);
				const params = await renewalParamsOf(certificate.id);

				const renewResult = await runCertbotCleaned([
					"--config",
					CERTBOT_INI,
					"renew",
					"--cert-name",
					`npm-${certificate.id}`,
					"--new-key",
					"--force-renewal",
				]);
				logger.info(renewResult);

				await revokeBestEffort({
					server: params.get("server"),
					account: params.get("account"),
					certPath: oldCertPath,
					keyPath: path.join(
						path.dirname(oldCertPath),
						path.basename(oldCertPath).replace(CERT_FILE, "privkey$<n>.pem"),
					),
					reason: "superseded",
				});

				return renewResult;
			},
			{ access, strict: true },
		);
	},

	revokeCertbot: async (certificate) => {
		logger.info(
			`Revoking Certbot certificates for Cert #${certificate.id}: ${certificate.domain_names.join(", ")}`,
		);

		const params = await renewalParamsOf(certificate.id);
		const live = liveCertPath(certificate.id);
		await revokeBestEffort({
			server: params.get("server"),
			account: params.get("account"),
			certName: `npm-${certificate.id}`,
			certPath: `${live}/cert.pem`,
			keyPath: `${live}/privkey.pem`,
			reason: "unspecified",
		});

		try {
			const result = await runCertbot([
				"--config",
				CERTBOT_INI,
				"delete",
				"--cert-name",
				`npm-${certificate.id}`,
			]);
			logger.info(result);
		} catch (err) {
			logger.error(err.message);
		}

		await rm(rooted(`/data/tls/certbot/live/npm-${certificate.id}.der`), { force: true });
		await rm(rooted(`/tmp/certbot-credentials/credentials-${certificate.id}`), { force: true });
	},

	/** Writes a test challenge file, then asks an outside service to fetch it for each domain */
	testHttpsChallenge: async (access, payload) => {
		access.can("certificates:manage");

		await writeFile(rooted("/data/public/acme-challenge/.well-known/acme-challenge/test-challenge"), "Success", {
			encoding: "utf8",
		});

		const results = [];

		for (const domain of payload.domains) {
			results.push({
				domain,
				status: await certificateAcme.performTestForDomain(domain),
			});
		}

		return results;
	},

	performTestForDomain: async (domain) => {
		logger.info(`Testing http challenge for ${domain}`);
		let result;
		try {
			const response = await fetch("https://www.site24x7.com/tools/restapi-tester", {
				method: "POST",
				headers: {
					"User-Agent": `NPMpro/${pjson.version}`,
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: `method=G&url=${encodeURI(`http://${domainToASCII(domain)}/.well-known/acme-challenge/test-challenge`)}&bodytype=T&locationid=10`,
			});

			try {
				result = await response.json();

				if (!response.ok) {
					logger.warn(
						`Failed to test HTTP challenge for domain ${domain} because HTTP status code ${response.status} was returned: ${result.message}`,
					);
				}
			} catch (err) {
				if (!response.ok) {
					logger.warn(
						`Failed to test HTTP challenge for domain ${domain} because HTTP status code ${response.status} was returned`,
					);
				} else {
					logger.warn(
						`Failed to test HTTP challenge for domain ${domain} because response failed to be parsed: ${err.message}`,
					);
				}
			}
		} catch (err) {
			logger.warn(`Failed to test HTTP challenge for domain ${domain}`, err);
		}

		if (!result) {
			return "failed";
		}
		if (result.error) {
			logger.info(
				`HTTP challenge test failed for domain ${domain} because error was returned: ${result.error.msg}`,
			);
			return `other:${result.error.msg}`;
		}
		if (`${result.responsecode}` === "200" && result.htmlresponse === "Success") {
			return "ok";
		}
		if (`${result.responsecode}` === "200") {
			logger.info(
				`HTTP challenge test failed for domain ${domain} because of invalid returned data:`,
				result.htmlresponse,
			);
			return "wrong-data";
		}
		if (`${result.responsecode}` === "404") {
			logger.info(`HTTP challenge test failed for domain ${domain} because code 404 was returned`);
			return "404";
		}
		if (
			`${result.responsecode}` === "0" ||
			(typeof result.reason === "string" && result.reason.toLowerCase() === "host unavailable")
		) {
			logger.info(`HTTP challenge test failed for domain ${domain} the host was not found`);
			return "no-host";
		}
		logger.info(`HTTP challenge test failed for domain ${domain} because code ${result.responsecode} was returned`);
		return `other:${result.responsecode}`;
	},
};

export { revokeBestEffort, runCertonly, withAcmeTarget };
export default certificateAcme;
