import { mkdir, rm, writeFile } from "node:fs/promises";
import dnsPlugins from "../certbot/dns-plugins.json" with { type: "json" };
import { assertProviderForNew } from "../lib/certbot.js";
import { buildValues, publicView, toIni } from "../lib/dns-credential-values.js";
import errs from "../lib/error.js";
import { defaultSecretBox, SecretBoxError } from "../lib/secret-box.js";
import certificateModel from "../models/certificate.js";
import dnsCredentialModel from "../models/dns_credential.js";
import internalAuditLog from "./audit-log.js";

const credentialsDir = "/tmp/certbot-credentials";

const decryptOrNull = (row) => {
	try {
		return defaultSecretBox.decrypt(row.values);
	} catch (err) {
		if (err instanceof SecretBoxError) return null;
		throw err;
	}
};

const toPublic = (row) => {
	const values = decryptOrNull(row);
	return { ...row.toJSON(), ...publicView(row.provider, values), decrypt_error: values === null };
};

// audit log meta without values
const auditMeta = (row) => ({ id: row.id, name: row.name, provider: row.provider, owner_user_id: row.owner_user_id });

const internalDnsCredential = {
	getAll: async (access, expand, searchQuery) => {
		access.can("certificates:view");
		const query = dnsCredentialModel.query().allowGraph("[owner,certificates]").orderBy("name", "ASC");
		if (access.visibility !== "all") query.andWhere("owner_user_id", access.token.getUserId(1));
		if (typeof searchQuery === "string") query.andWhere("name", "like", `%${searchQuery}%`);
		if (expand) query.withGraphFetched(`[${expand.join(", ")}]`);
		return (await query).map(toPublic);
	},

	get: async (access, data) => {
		access.can("certificates:view");
		const query = dnsCredentialModel.query().where("id", data.id).first();
		if (access.visibility !== "all") query.andWhere("owner_user_id", access.token.getUserId(1));
		if (data.expand) query.allowGraph("[owner,certificates]").withGraphFetched(`[${data.expand.join(", ")}]`);
		const row = await query;
		if (!row?.id) throw new errs.ItemNotFoundError(data.id);
		return row;
	},

	getPublic: async (access, data) => toPublic(await internalDnsCredential.get(access, data)),

	create: async (access, data) => {
		access.can("certificates:manage");
		if (!dnsPlugins[data.provider]) throw new errs.ValidationError(`Unknown DNS provider '${data.provider}'`);
		assertProviderForNew(data.provider);
		const ownerUserId = access.token.getUserId(1);
		await internalDnsCredential.assertNameFree(ownerUserId, data.name);

		const row = await dnsCredentialModel.query().insertAndFetch({
			owner_user_id: ownerUserId,
			name: data.name,
			provider: data.provider,
			values: defaultSecretBox.encrypt(buildValues(data.provider, data, null)),
		});
		await internalAuditLog.add(access, {
			action: "created",
			object_type: "dns-credential",
			object_id: row.id,
			meta: auditMeta(row),
		});
		return toPublic(row);
	},

	update: async (access, data) => {
		access.can("certificates:manage");
		const row = await internalDnsCredential.get(access, { id: data.id });
		const provider = data.provider ?? row.provider;
		if (!dnsPlugins[provider]) throw new errs.ValidationError(`Unknown DNS provider '${provider}'`);
		if (provider !== row.provider) assertProviderForNew(provider);
		if (provider !== row.provider && (await internalDnsCredential.countCertificates(row.id)) > 0) {
			throw new errs.ValidationError("The provider cannot change while certificates use this credential");
		}
		if (provider !== row.provider && data.fields === undefined && data.ini === undefined) {
			throw new errs.ValidationError("Changing the DNS provider requires entering its credentials");
		}
		if (data.name !== undefined && data.name !== row.name) {
			await internalDnsCredential.assertNameFree(row.owner_user_id, data.name);
		}

		const patch = { name: data.name ?? row.name, provider };
		if (data.fields !== undefined || data.ini !== undefined) {
			// secrets of another provider are never carried over
			const previous = provider === row.provider ? decryptOrNull(row) : null;
			patch.values = defaultSecretBox.encrypt(buildValues(provider, data, previous));
		}

		const saved = await dnsCredentialModel.query().patchAndFetchById(row.id, patch);
		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "dns-credential",
			object_id: row.id,
			meta: auditMeta(saved),
		});
		if (patch.values) await internalDnsCredential.writeFilesFor(row.id);
		return toPublic(saved);
	},

	delete: async (access, data) => {
		access.can("certificates:manage");
		const row = await internalDnsCredential.get(access, { id: data.id });
		const inUse = await internalDnsCredential.countCertificates(row.id);
		if (inUse > 0) throw new errs.ValidationError(`DNS credential is still used by ${inUse} certificate(s)`);
		await dnsCredentialModel.query().deleteById(row.id);
		await internalAuditLog.add(access, {
			action: "deleted",
			object_type: "dns-credential",
			object_id: row.id,
			meta: auditMeta(row),
		});
		return toPublic(row);
	},

	countCertificates: (id) => certificateModel.query().where("npmpro_dns_credential_id", id).resultSize(),

	assertNameFree: async (ownerUserId, name) => {
		const taken = await dnsCredentialModel.query().where({ owner_user_id: ownerUserId, name }).resultSize();
		if (taken > 0) throw new errs.ValidationError(`A DNS credential named '${name}' already exists`);
	},

	/**
	 * Certbot credentials file content, no access check
	 *
	 * @param   {Number}  id
	 * @returns {Promise<String>}
	 */
	getIni: async (id) => {
		const row = await dnsCredentialModel.query().findById(id);
		if (!row) throw new errs.ValidationError("The certificate has no DNS credential, select one");
		try {
			return toIni(defaultSecretBox.decrypt(row.values));
		} catch (err) {
			if (err instanceof SecretBoxError) {
				throw new errs.ValidationError(
					`DNS credential '${row.name}' cannot be decrypted, enter its values again`,
					undefined,
					{ cause: err },
				);
			}
			throw err;
		}
	},

	writeCertificateFile: async (certificate) => {
		await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
		await writeFile(
			`${credentialsDir}/credentials-${certificate.id}`,
			await internalDnsCredential.getIni(certificate.npmpro_dns_credential_id),
			{ mode: 0o600 },
		);
	},

	removeCertificateFile: async (certificateId) => {
		await rm(`${credentialsDir}/credentials-${certificateId}`, { force: true });
	},

	writeFilesFor: async (credentialId) => {
		const certificates = await certificateModel
			.query()
			.where("npmpro_dns_credential_id", credentialId)
			.andWhere("npmpro_dns_challenge", 1);
		for (const certificate of certificates) await internalDnsCredential.writeCertificateFile(certificate);
	},
};

export default internalDnsCredential;
