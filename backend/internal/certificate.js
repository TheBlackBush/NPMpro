import { open, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { ZipArchive } from "archiver";
import dayjs from "dayjs";
import { assertProviderForNew, runCertbot } from "../lib/certbot.js";
import { CERTBOT_INI } from "../lib/certbot-ini.js";
import { assertCertificateUse, customCertPath, liveCertPath, mtlsCertFile } from "../lib/certificate-files.js";
import { maintenance } from "../lib/database/maintenance.js";
import errs from "../lib/error.js";
import { expiryBounds } from "../lib/expiry.js";
import { pickCertificateFields } from "../lib/helpers.js";
import { rooted } from "../lib/paths.js";
import { createRenewalTimer } from "../lib/renewal-timer.js";
import { getRuntimeConfig } from "../lib/runtime-config.js";
import apiValidator from "../lib/validator/api.js";
import { ssl as logger } from "../logger.js";
import certificateModel from "../models/certificate.js";
import deadHostModel from "../models/dead_host.js";
import proxyHostModel from "../models/proxy_host.js";
import redirectionHostModel from "../models/redirection_host.js";
import streamModel from "../models/stream.js";
import { getValidationSchema } from "../schema/index.js";
import internalAuditLog from "./audit-log.js";
import certificateAcme from "./certificate-acme.js";
import certificateCustom, { ALLOWED_SSL_FILES } from "./certificate-custom.js";
import certificateInfo from "./certificate-info.js";
import internalDnsCredential from "./dns-credential.js";
import internalNginx from "./nginx.js";
import { runtimeExclusive } from "./runtime-queue.js";
import { recoverStapling } from "./stapling-recovery.js";

const getNiceName = (domainNames) => {
	const niceName = domainNames.join(", ");
	if (niceName.length <= 255) return niceName;
	const shown = [];
	for (const domain of domainNames) {
		if ([...shown, domain, "..."].join(", ").length > 255) break;
		shown.push(domain);
	}
	return [...shown, "..."].join(", ");
};

// the startup apply sets the runtime setting (restartTimer) before initTimer runs; env (envs.sh default 3) until then
const renewalTimer = createRenewalTimer({
	run: () => internalCertificate.processExpiringHosts(),
	hours: Number.parseInt(process.env.CERTBOT_RUN_INTERVAL, 10),
	busy: () => internalCertificate.intervalProcessing,
	log: logger,
});

const internalCertificate = {
	...certificateInfo,
	...certificateAcme,
	...certificateCustom,
	allowedSslFiles: ALLOWED_SSL_FILES,
	// the renewal guard: read through busy() and processExpiringHosts, written only on this object
	intervalProcessing: false,
	getLiveCertPath: liveCertPath,
	getCustomCertPath: customCertPath,
	getMtlsCertFile: mtlsCertFile,

	/**
	 * Sets the renewal interval and restarts a running timer with it (a timer not started yet uses it in initTimer)
	 *
	 * @param {number} [hours]  an invalid value keeps the current interval
	 */
	restartTimer: (hours) => renewalTimer.restart(hours),

	/**
	 * Stops renewals for a restore or a database move: waits for a running renewal, then the timer skips its runs
	 * until resumeRenewals(). With timeoutMs (a move) it rejects with "writer-running" when the renewal takes longer
	 * and leaves the timer as it was.
	 *
	 * @param {{ timeoutMs?: number }} [options]
	 */
	pauseRenewals: (options) => renewalTimer.pauseAndWait(options),

	resumeRenewals: () => renewalTimer.resume(),

	initTimer: () => {
		if (!renewalTimer.start()) return;
		logger.info(`Certbot Renewal Timer initialized (every ${renewalTimer.hours()} hours)`);
		void internalCertificate.processExpiringHosts();
	},

	/** Timer run: renews the certificates of expiring hosts */
	processExpiringHosts: async () => {
		if (internalCertificate.intervalProcessing) {
			return;
		}

		internalCertificate.intervalProcessing = true;
		logger.info("Renewing Certbot TLS certs close to expiry...");

		try {
			try {
				const result = await runCertbot([
					"--config",
					CERTBOT_INI,
					"renew",
					"--server",
					process.env.ACME_SERVER,
					"--quiet",
				]);

				if (result) logger.info(`Renew Result: ${result}`);
			} catch (err) {
				logger.warn(`Certbot completed with errors: ${err}`);
			}

			try {
				await internalNginx.reload();
			} catch (err) {
				logger.error(err);
			}
			// renewed certificates whose configs were written before their OCSP response existed
			await recoverStapling();

			const certificates = await certificateModel.query().where("provider", "letsencrypt");

			if (certificates && certificates.length > 0) {
				const updatePromises = certificates.map(async (certificate) => {
					try {
						const certInfo = await internalCertificate.getCertificateInfoFromFile(
							`${internalCertificate.getLiveCertPath(certificate.id)}/fullchain.pem`,
						);

						await certificateModel
							.query()
							.where("id", certificate.id)
							.andWhere("provider", "letsencrypt")
							.patch({
								nice_name: getNiceName(certificate.domain_names),
								expires_on: dayjs.unix(certInfo.dates.to).format("YYYY-MM-DD HH:mm:ss"),
							});
					} catch (err) {
						// one failure must not stop the others
						logger.error(err);
					}
				});

				await Promise.all(updatePromises);
				logger.info("Renew Complete");
			}
		} catch (err) {
			logger.error(err);
		} finally {
			internalCertificate.intervalProcessing = false;
		}
	},

	create: async (access, data) => {
		access.can("certificates:manage");
		data.owner_user_id = access.token.getUserId(1);

		if (data.npmpro_dns_challenge) {
			assertProviderForNew(data.npmpro_dns_provider);
			const credential = await internalDnsCredential.get(access, { id: data.npmpro_dns_credential_id });
			if (credential.provider !== data.npmpro_dns_provider) {
				throw new errs.ValidationError("The DNS credential belongs to another DNS provider");
			}
		} else {
			delete data.npmpro_dns_provider;
			delete data.npmpro_dns_credential_id;
			delete data.npmpro_propagation_seconds;
		}

		if (data.provider === "letsencrypt") {
			data.nice_name = getNiceName(data.domain_names);
		}

		const certificate = await certificateModel.query().insertAndFetch(data);

		try {
			if (certificate.provider === "letsencrypt") {
				if (certificate.npmpro_dns_challenge) {
					await internalCertificate.requestCertbotWithDnsChallenge(certificate);
				} else {
					await internalCertificate.requestCertbot(certificate);
				}

				// the expiry date comes from the issued file
				const certInfo = await internalCertificate.getCertificateInfoFromFile(
					`${internalCertificate.getLiveCertPath(certificate.id)}/fullchain.pem`,
				);
				const savedRow = await certificateModel.query().patchAndFetchById(certificate.id, {
					expires_on: dayjs.unix(certInfo.dates.to).format("YYYY-MM-DD HH:mm:ss"),
				});

				await internalCertificate.addCreatedAuditLog(access, certificate.id, savedRow);

				return savedRow;
			}
		} catch (err) {
			// the certificate never existed properly: hard delete
			await certificateModel.query().deleteById(certificate.id);
			throw err;
		}

		const savedRow = await internalCertificate.get(access, { id: certificate.id });

		await internalCertificate.addCreatedAuditLog(access, certificate.id, savedRow);

		return savedRow;
	},

	addCreatedAuditLog: async (access, certificate_id, meta) => {
		await internalAuditLog.add(access, {
			action: "created",
			object_type: "certificate",
			object_id: certificate_id,
			meta,
		});
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {Number}  data.id
	 * @param  {String}  [data.email]
	 * @param  {String}  [data.name]
	 * @return {Promise}
	 */
	update: async (access, data) => {
		access.can("certificates:manage");
		const row = await internalCertificate.get(access, { id: data.id });

		const savedRow = await certificateModel.query().patchAndFetchById(row.id, data);

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "certificate",
			object_id: row.id,
			meta: savedRow,
		});

		return savedRow;
	},

	/**
	 * @param  {Access}   access
	 * @param  {Object}   data
	 * @param  {Number}   data.id
	 * @param  {Boolean}  [data.mtls]  a host's certificate: true for its mTLS CA, false for its server certificate
	 * @return {Promise}
	 */
	get: async (access, data) => {
		access.can("certificates:view");
		const query = certificateModel.query().where("id", data.id).first();

		if (access.visibility !== "all") {
			query.andWhere("owner_user_id", access.token.getUserId(1));
		}

		const row = await query;
		if (!row?.id) {
			throw new errs.ItemNotFoundError(data.id);
		}
		if (data.mtls !== undefined) assertCertificateUse(row, data.mtls);

		return row;
	},

	download: async (access, data, dir) => {
		access.can("certificates:manage");
		// a GET that writes an audit entry: during a database move that entry could be lost
		const release = maintenance.beginWrite();
		try {
			const certificate = await internalCertificate.get(access, data);

			let zipDirectory;
			let fileNames;
			if (certificate.provider === "letsencrypt") {
				zipDirectory = internalCertificate.getLiveCertPath(data.id);
				fileNames = ["fullchain.pem", "privkey.pem"];
			} else if (certificate.provider === "mtls") {
				const mtlsFile = internalCertificate.getMtlsCertFile(data.id);
				zipDirectory = path.dirname(mtlsFile);
				fileNames = [path.basename(mtlsFile)];
			} else {
				zipDirectory = internalCertificate.getCustomCertPath(data.id);
				fileNames = ["fullchain.pem", "privkey.pem"];
			}

			try {
				await stat(zipDirectory);
			} catch (err) {
				throw new errs.ItemNotFoundError(`Certificate ${certificate.nice_name} does not exists`, {
					cause: err,
				});
			}

			const certFiles = [];
			for (const fileName of fileNames) {
				try {
					certFiles.push([fileName, await realpath(path.join(zipDirectory, fileName))]);
				} catch (err) {
					throw new errs.ItemNotFoundError(`Certificate ${certificate.nice_name} is missing ${fileName}`, {
						cause: err,
					});
				}
			}

			const opName = path.join(dir, `npm-${data.id}-${Date.now()}.zip`);

			await internalCertificate.zipFiles(certFiles, opName);
			logger.debug("zip completed : ", opName);
			// the zip holds the private key
			await internalAuditLog.add(access, {
				action: "downloaded",
				object_type: "certificate",
				object_id: certificate.id,
				meta: { id: certificate.id, nice_name: certificate.nice_name, provider: certificate.provider },
			});
			return {
				fileName: opName,
			};
		} finally {
			release();
		}
	},

	zipFiles: async (source, out) => {
		const archive = new ZipArchive({ zlib: { level: 9 } });
		archive.on("warning", (err) => archive.destroy(err));
		const written = pipeline(archive, (await open(out, "w")).createWriteStream());

		for (const [name, filePath] of source) archive.file(filePath, { name });

		await Promise.all([written, archive.finalize()]);
	},

	delete: async (access, data) => {
		access.can("certificates:manage");
		const row = await internalCertificate.get(access, { id: data.id });

		// in the runtime settings queue: a save of the default certificate cannot pass its check at the same time
		await runtimeExclusive(async () => {
			// the effective default certificate (env DEFAULT_CERT_ID or the Certificates & TLS setting)
			const { values: tls } = await getRuntimeConfig("certificates");
			if (row.id === tls.default_certificate_id) {
				throw new errs.ValidationError("Certificate is still in use by the default host");
			}

			for (const hostModel of [proxyHostModel, redirectionHostModel, deadHostModel, streamModel]) {
				if (
					(await hostModel
						.query()
						.where("certificate_id", row.id)
						.orWhere("npmpro_mtls_certificate_id", row.id)
						.resultSize()) > 0
				) {
					throw new errs.ValidationError("Certificate is still in use");
				}
			}

			await certificateModel.query().deleteById(row.id);
		});

		await internalAuditLog.add(access, {
			action: "deleted",
			object_type: "certificate",
			object_id: row.id,
			meta: row,
		});

		if (row.provider === "letsencrypt") {
			await internalCertificate.revokeCertbot(row);
		} else if (row.provider === "mtls") {
			await rm(internalCertificate.getMtlsCertFile(row.id), { force: true });
		} else {
			await rm(rooted(`/data/tls/custom/npm-${row.id}`), { force: true, recursive: true });
			await rm(rooted(`/data/tls/custom/npm-${row.id}.der`), { force: true });
		}
		return row;
	},

	/**
	 * @param   {Access}  access
	 * @param   {Array}   [expand]
	 * @param   {String}  [searchQuery]
	 */
	getAll: (access, expand, searchQuery) => {
		access.can("certificates:view");

		const query = certificateModel
			.query()
			.groupBy("id")
			.allowGraph(
				"[owner,proxy_hosts,redirection_hosts,dead_hosts,streams,mtls_proxy_hosts,mtls_redirection_hosts,mtls_dead_hosts,mtls_streams]",
			)
			.orderBy("nice_name", "ASC");

		if (access.visibility !== "all") {
			query.andWhere("owner_user_id", access.token.getUserId(1));
		}

		if (typeof searchQuery === "string") {
			query.where(function () {
				this.where("nice_name", "like", `%${searchQuery}%`);
			});
		}

		if (expand) query.withGraphFetched(`[${expand.join(", ")}]`);

		return query;
	},

	/**
	 * @param   {Number}  userId
	 * @param   {String}  visibility
	 */
	getCount: (userId, visibility) => {
		const query = certificateModel.query();

		if (visibility !== "all") {
			query.andWhere("owner_user_id", userId);
		}

		return query.resultSize();
	},

	/**
	 * Report use: certificates that expire within the warning window or already expired
	 *
	 * @param   {Number}  userId
	 * @param   {String}  visibility
	 * @returns {Promise<{expiring: Number, expired: Number}>}
	 */
	getExpiryCounts: async (userId, visibility) => {
		const { now, soon } = expiryBounds();
		const format = (date) => dayjs(date).format("YYYY-MM-DD HH:mm:ss");
		const base = () => {
			const query = certificateModel.query().whereIn("provider", ["letsencrypt", "other"]);
			if (visibility !== "all") {
				query.andWhere("owner_user_id", userId);
			}
			return query;
		};

		const [expired, expiring] = await Promise.all([
			base().where("expires_on", "<", format(now)).resultSize(),
			base().where("expires_on", ">=", format(now)).andWhere("expires_on", "<", format(soon)).resultSize(),
		]);

		return { expiring, expired };
	},

	createQuickCertificate: (access, data) =>
		internalCertificate.create(
			access,
			apiValidator(getValidationSchema("/nginx/certificates", "post"), {
				provider: "letsencrypt",
				domain_names: data.domain_names,
				...pickCertificateFields(data),
			}),
		),

	upload: async (access, data) => {
		const row = await internalCertificate.get(access, { id: data.id });
		if (row.provider !== "other" && row.provider !== "mtls") {
			throw new errs.ValidationError("Cannot upload certificates for this type of provider");
		}
		const isMtls = row.provider === "mtls";

		const validations = internalCertificate.validate(access, data);
		if (validations.certificate === undefined) throw new errs.ValidationError("Certificate file was not provided");
		if (!isMtls && validations.certificate_key === undefined) {
			throw new errs.ValidationError("Certificate Key file was not provided");
		}

		const certs = {};
		for (const [name, [file]] of Object.entries(data.files)) {
			if ((isMtls ? ["certificate"] : internalCertificate.allowedSslFiles).includes(name)) {
				certs[name] = file.buffer.toString();
			}
		}

		const certificate = await internalCertificate.update(access, {
			id: data.id,
			expires_on: dayjs.unix(validations.certificate.dates.to).format("YYYY-MM-DD HH:mm:ss"),
			domain_names: validations.certificate.cn,
		});

		await internalCertificate.writeCustomCert({ ...certificate, ...certs });
		await internalNginx.reload();
		return certificate;
	},

	/**
	 * Links another saved DNS credential, used from the next renewal on
	 *
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @param   {Number}  data.id
	 * @param   {Number}  data.npmpro_dns_credential_id
	 */
	setDnsCredential: async (access, data) => {
		access.can("certificates:manage");
		const certificate = await internalCertificate.get(access, { id: data.id });
		if (certificate.provider !== "letsencrypt" || !certificate.npmpro_dns_challenge) {
			throw new errs.ValidationError("Only DNS challenge certificates use a DNS credential");
		}
		const credential = await internalDnsCredential.get(access, { id: data.npmpro_dns_credential_id });
		if (credential.provider !== certificate.npmpro_dns_provider) {
			throw new errs.ValidationError("The DNS credential belongs to another DNS provider");
		}
		const saved = await certificateModel
			.query()
			.patchAndFetchById(certificate.id, { npmpro_dns_credential_id: credential.id });
		await internalDnsCredential.writeCertificateFile(saved);
		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "certificate",
			object_id: saved.id,
			meta: saved,
		});
		return saved;
	},

	renew: async (access, data) => {
		access.can("certificates:manage");
		const certificate = await internalCertificate.get(access, data);

		if (certificate.provider === "letsencrypt") {
			await internalCertificate.renewCertbot(certificate);
			const certInfo = await internalCertificate.getCertificateInfoFromFile(
				`${internalCertificate.getLiveCertPath(certificate.id)}/fullchain.pem`,
			);

			const updatedCertificate = await certificateModel.query().patchAndFetchById(certificate.id, {
				nice_name: getNiceName(certificate.domain_names),
				expires_on: dayjs.unix(certInfo.dates.to).format("YYYY-MM-DD HH:mm:ss"),
			});

			try {
				await internalNginx.reload();
			} finally {
				await internalAuditLog.add(access, {
					action: "updated",
					object_type: "certificate",
					object_id: updatedCertificate.id,
					meta: updatedCertificate,
				});
			}

			return updatedCertificate;
		}

		throw new errs.ValidationError("Only Certbot certificates can be renewed");
	},
};

export default internalCertificate;
