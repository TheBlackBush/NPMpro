import { mkdir, rm, writeFile } from "node:fs/promises";
import dnsPlugins from "../certbot/dns-plugins.json" with { type: "json" };
import { assertProviderForNew } from "../lib/certbot.js";
import { buildValues, publicView, toIni } from "../lib/dns-credential-values.js";
import errs from "../lib/error.js";
import { rooted } from "../lib/paths.js";
import { defaultSecretBox, SecretBoxError } from "../lib/secret-box.js";
import certificateModel from "../models/certificate.js";
import ddnsRecordModel from "../models/ddns_record.js";
import dnsCredentialModel from "../models/dns_credential.js";
import internalAuditLog from "./audit-log.js";
import internalDnsDomain from "./dns-domain.js";

const credentialsDir = rooted("/tmp/certbot-credentials");

const decryptOrNull = (row) => {
	try {
		return defaultSecretBox.decrypt(row.values);
	} catch (err) {
		if (err instanceof SecretBoxError) return null;
		throw err;
	}
};

const GRAPH = "[owner,certificates,domains]";
const NO_CHANGES = Object.freeze({ added: [], removed: [] });
const byName = (a, b) => a.localeCompare(b);

const toPublic = (row) => {
	const values = decryptOrNull(row);
	const json = { ...row.toJSON(), ...publicView(row.provider, values), decrypt_error: values === null };
	// expanded domains are names only
	if (Array.isArray(row.domains)) json.domains = row.domains.map((domain) => domain.name).sort(byName);
	return json;
};

// the domain changes of a save, for the audit meta; nothing when none changed
const domainMeta = ({ added, removed }) => ({
	...(added.length > 0 ? { domains_added: added } : {}),
	...(removed.length > 0 ? { domains_removed: removed } : {}),
});

const withDomains = async (row) => ({ ...toPublic(row), domains: await internalDnsDomain.namesOf(row.id) });

// audit log meta without values
const auditMeta = (row) => ({ id: row.id, name: row.name, provider: row.provider, owner_user_id: row.owner_user_id });

const internalDnsCredential = {
	getAll: async (access, expand, searchQuery) => {
		access.can("certificates:view");
		const query = dnsCredentialModel.query().allowGraph(GRAPH).orderBy("name", "ASC");
		if (access.visibility !== "all") query.andWhere("owner_user_id", access.token.getUserId(1));
		if (typeof searchQuery === "string") query.andWhere("name", "like", `%${searchQuery}%`);
		if (expand) query.withGraphFetched(`[${expand.join(", ")}]`);
		return (await query).map(toPublic);
	},

	get: async (access, data) => {
		access.can("certificates:view");
		const query = dnsCredentialModel.query().where("id", data.id).first();
		if (access.visibility !== "all") query.andWhere("owner_user_id", access.token.getUserId(1));
		if (data.expand) query.allowGraph(GRAPH).withGraphFetched(`[${data.expand.join(", ")}]`);
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

		const { row, changes } = await internalDnsDomain.withOwnerLock(ownerUserId, () =>
			dnsCredentialModel.transaction(async (trx) => {
				await internalDnsCredential.assertNameFree(ownerUserId, data.name, trx);
				const inserted = await dnsCredentialModel.query(trx).insertAndFetch({
					owner_user_id: ownerUserId,
					name: data.name,
					provider: data.provider,
					values: defaultSecretBox.encrypt(buildValues(data.provider, data, null)),
				});
				const domainChanges =
					data.domains === undefined
						? NO_CHANGES
						: await internalDnsDomain.replaceLocked(inserted, data.domains, trx);
				return { row: inserted, changes: domainChanges };
			}),
		);
		await internalAuditLog.add(access, {
			action: "created",
			object_type: "dns-credential",
			object_id: row.id,
			meta: { ...auditMeta(row), ...domainMeta(changes) },
		});
		return await withDomains(row);
	},

	update: async (access, data) => {
		access.can("certificates:manage");
		const row = await internalDnsCredential.get(access, { id: data.id });
		const provider = data.provider ?? row.provider;
		if (!dnsPlugins[provider]) throw new errs.ValidationError(`Unknown DNS provider '${provider}'`);
		if (provider !== row.provider) assertProviderForNew(provider);
		if (provider !== row.provider && data.fields === undefined && data.ini === undefined) {
			throw new errs.ValidationError("Changing the DNS provider requires entering its credentials");
		}

		const patch = { name: data.name ?? row.name, provider };
		if (data.fields !== undefined || data.ini !== undefined) {
			// secrets of another provider are never carried over
			const previous = provider === row.provider ? decryptOrNull(row) : null;
			patch.values = defaultSecretBox.encrypt(buildValues(provider, data, previous));
		}

		const { saved, changes } = await internalDnsDomain.withOwnerLock(row.owner_user_id, () =>
			dnsCredentialModel.transaction(async (trx) => {
				// the credential may have been deleted while this waited for the lock
				if (!(await dnsCredentialModel.query(trx).findById(row.id))) throw new errs.ItemNotFoundError(row.id);
				if (provider !== row.provider && (await internalDnsCredential.countCertificates(row.id, trx)) > 0) {
					throw new errs.ValidationError("The provider cannot change while certificates use this credential");
				}
				if (provider !== row.provider) await internalDnsCredential.assertNoDdnsRecords(row.id, trx);
				if (data.name !== undefined && data.name !== row.name) {
					await internalDnsCredential.assertNameFree(row.owner_user_id, data.name, trx);
				}
				const patched = await dnsCredentialModel.query(trx).patchAndFetchById(row.id, patch);
				const domainChanges =
					data.domains === undefined
						? NO_CHANGES
						: await internalDnsDomain.replaceLocked(patched, data.domains, trx);
				return { saved: patched, changes: domainChanges };
			}),
		);
		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "dns-credential",
			object_id: row.id,
			meta: { ...auditMeta(saved), ...domainMeta(changes) },
		});
		if (patch.values) await internalDnsCredential.writeFilesFor(row.id);
		return await withDomains(saved);
	},

	delete: async (access, data) => {
		access.can("certificates:manage");
		const row = await internalDnsCredential.get(access, { id: data.id });
		// SQLite does not run the foreign key's cascade: the domains go in code, in the same transaction
		const domains = await internalDnsDomain.withOwnerLock(row.owner_user_id, () =>
			dnsCredentialModel.transaction(async (trx) => {
				// another delete of it may have run while this waited for the lock
				if (!(await dnsCredentialModel.query(trx).findById(row.id))) throw new errs.ItemNotFoundError(row.id);
				const inUse = await internalDnsCredential.countCertificates(row.id, trx);
				if (inUse > 0)
					throw new errs.ValidationError(`DNS credential is still used by ${inUse} certificate(s)`);
				await internalDnsCredential.assertNoDdnsRecords(row.id, trx);
				const names = await internalDnsDomain.namesOf(row.id, trx);
				await internalDnsDomain.removeAllLocked(row.id, trx);
				await dnsCredentialModel.query(trx).deleteById(row.id);
				return names;
			}),
		);
		await internalAuditLog.add(access, {
			action: "deleted",
			object_type: "dns-credential",
			object_id: row.id,
			meta: { ...auditMeta(row), ...(domains.length > 0 ? { domains } : {}) },
		});
		return { ...toPublic(row), domains };
	},

	countCertificates: (id, trx) => certificateModel.query(trx).where("npmpro_dns_credential_id", id).resultSize(),

	// a credential that dynamic DNS records use keeps its provider and cannot be deleted
	assertNoDdnsRecords: async (id, trx) => {
		const count = await ddnsRecordModel.query(trx).where("dns_credential_id", id).resultSize();
		if (count > 0) {
			throw new errs.ValidationError(
				`The DNS credential is still used by ${count} dynamic DNS record(s)`,
				"error.dns-credential-in-use-ddns",
				{ values: { count } },
			);
		}
	},

	assertNameFree: async (ownerUserId, name, trx) => {
		const taken = await dnsCredentialModel.query(trx).where({ owner_user_id: ownerUserId, name }).resultSize();
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
		return toIni(internalDnsCredential.openValues(row));
	},

	/**
	 * The decrypted values of a credential row, no access check
	 *
	 * @param   {Object}  row
	 * @returns {Object}  { fields } or { ini }
	 * @throws  {errs.ValidationError}  the values cannot be decrypted (another key or a corrupt value)
	 */
	openValues: (row) => {
		const values = decryptOrNull(row);
		if (values === null) {
			throw new errs.ValidationError(`DNS credential '${row.name}' cannot be decrypted, enter its values again`);
		}
		return values;
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
