import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { domainToASCII } from "node:url";
import dnsPlugins from "../certbot/dns-plugins.json" with { type: "json" };
import { installPlugin, runCertbot } from "../lib/certbot.js";
import { CERTBOT_INI } from "../lib/certbot-ini.js";
import { liveCertPath } from "../lib/certificate-files.js";
import errs from "../lib/error.js";
import { rooted } from "../lib/paths.js";
import { ssl as logger } from "../logger.js";
import pjson from "../package.json" with { type: "json" };
import internalDnsCredential from "./dns-credential.js";

const renewalServerPattern = /^server = (?<server>.+)$/mu;

const certificateAcme = {
	/** Requests a certificate through the HTTP challenge */
	requestCertbot: async (certificate) => {
		logger.info(
			`Requesting Certbot certificates for Cert #${certificate.id}: ${certificate.domain_names.join(", ")}`,
		);

		certificate.domain_names = certificate.domain_names.map((v) => v.replace(/^\[|\]$/gu, ""));
		const { ips = [], domains = [] } = Object.groupBy(certificate.domain_names, (entry) =>
			net.isIP(entry) === 0 ? "domains" : "ips",
		);

		const result = await runCertbot([
			"--config",
			CERTBOT_INI,
			"certonly",
			"--server",
			process.env.ACME_SERVER,
			"--cert-name",
			`npm-${certificate.id}`,
			...(domains.length > 0 ? ["--domains", domains.map(domainToASCII).join(",")] : []),
			...ips.flatMap((ip) => ["--ip-address", ip]),
			...(certificate.npmpro_reuse_key ? ["--reuse-key"] : ["--no-reuse-key"]),
			"--authenticator",
			"webroot",
		]);
		logger.success(result);
		return result;
	},

	requestCertbotWithDnsChallenge: async (certificate) => {
		const dnsPlugin = dnsPlugins[certificate.npmpro_dns_provider];
		if (!dnsPlugin) {
			throw new errs.ValidationError(`Unknown DNS provider '${certificate.npmpro_dns_provider}'`);
		}
		await installPlugin(certificate.npmpro_dns_provider);

		logger.info(
			`Requesting Certbot certificates via ${dnsPlugin.name} for Cert #${certificate.id}: ${certificate.domain_names.join(", ")}`,
		);

		const credentialsLocation = rooted(`/tmp/certbot-credentials/credentials-${certificate.id}`);
		await internalDnsCredential.writeCertificateFile(certificate);

		try {
			const result = await runCertbot([
				"--config",
				CERTBOT_INI,
				"certonly",
				"--server",
				process.env.ACME_SERVER,
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
			]);
			logger.info(result);
			return result;
		} catch (err) {
			await rm(credentialsLocation, { force: true });
			throw err;
		}
	},

	renewCertbot: async (certificate) => {
		const dnsPlugin = certificate.npmpro_dns_challenge ? dnsPlugins[certificate.npmpro_dns_provider] : null;
		if (certificate.npmpro_dns_challenge && !dnsPlugin) {
			throw new errs.ValidationError(`Unknown DNS provider '${certificate.npmpro_dns_provider}'`);
		}

		logger.info(
			`Renewing Certbot certificates ${dnsPlugin ? `via ${dnsPlugin.name} ` : ""}for Cert #${certificate.id}: ${certificate.domain_names.join(", ")}`,
		);

		const oldCertPath = await realpath(`${liveCertPath(certificate.id)}/cert.pem`);
		const oldServer = (
			await readFile(rooted(`/data/tls/certbot/renewal/npm-${certificate.id}.conf`), "utf8")
		).match(renewalServerPattern)?.groups.server;

		const renewResult = await runCertbot([
			"--config",
			CERTBOT_INI,
			"renew",
			"--server",
			process.env.ACME_SERVER,
			"--cert-name",
			`npm-${certificate.id}`,
			"--new-key",
			"--force-renewal",
		]);
		logger.info(renewResult);

		try {
			const revokeResult = await runCertbot([
				"--config",
				CERTBOT_INI,
				"revoke",
				"--server",
				oldServer,
				"--cert-path",
				oldCertPath,
				"--reason",
				"superseded",
				"--no-delete-after-revoke",
			]);
			logger.info(revokeResult);
		} catch {
			// the revoke is best effort
		}

		return renewResult;
	},

	revokeCertbot: async (certificate) => {
		logger.info(
			`Revoking Certbot certificates for Cert #${certificate.id}: ${certificate.domain_names.join(", ")}`,
		);

		try {
			const result = await runCertbot([
				"--config",
				CERTBOT_INI,
				"revoke",
				"--cert-name",
				`npm-${certificate.id}`,
				"--reason",
				"unspecified",
				"--no-delete-after-revoke",
			]);
			logger.info(result);
		} catch (err) {
			logger.error(err.message);
		}

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
		access.can("certificates:view");

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

export default certificateAcme;
