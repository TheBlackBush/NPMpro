import { normalizeDomainName } from "../lib/dns-domain-name.js";
import errs from "../lib/error.js";
import { createKeyedLock } from "../lib/keyed-lock.js";
import dnsCredentialModel from "../models/dns_credential.js";
import dnsDomainModel from "../models/dns_domain.js";
import internalAuditLog from "./audit-log.js";

// The DNS domains (zones) of the DNS credentials; the only writer of npmpro_dns_domain. One owner never keeps a name
// on two credentials; the table has no owner column to hold that as an index (the owner is the credential's), so the
// check reads before it writes and every change of an owner's domains runs under that owner's lock.
const ownerLock = createKeyedLock();

const credentialMeta = (credential) => ({
	dns_credential_id: credential.id,
	credential_name: credential.name,
	provider: credential.provider,
	owner_user_id: credential.owner_user_id,
});

const ownOnly = (access) => access.visibility !== "all";

/** the credential, visible to the user; 404 otherwise, as a certificate request answers */
const visibleCredential = async (access, id, trx) => {
	const query = dnsCredentialModel.query(trx).findById(id);
	if (ownOnly(access)) query.andWhere("owner_user_id", access.token.getUserId(1));
	const row = await query;
	if (!row) throw new errs.ItemNotFoundError(id);
	return row;
};

const refusedName = (input, error) =>
	new errs.ValidationError(`'${input}' is not a DNS domain such as example.com`, error, {
		values: { domain: String(input) },
	});

/**
 * The names a save adds to a credential, normalized and each once. An entry equal to a stored name of the credential,
 * as stored or once normalized, is kept and not checked again (a stored value is never refused on a save that keeps
 * it). One name the owner keeps on another credential refuses the whole list.
 *
 * @param   {Object}       credential  the credential row
 * @param   {string[]}     inputs
 * @param   {Set<string>}  stored      the credential's stored names
 * @param   {Object}       trx
 * @returns {Promise<{ fresh: string[], kept: Set<string> }>}
 */
const planNames = async (credential, inputs, stored, trx) => {
	const fresh = [];
	const kept = new Set();
	for (const input of inputs) {
		if (stored.has(input)) {
			kept.add(input);
			continue;
		}
		const normalized = normalizeDomainName(input);
		if (normalized.error) throw refusedName(input, normalized.error);
		if (stored.has(normalized.name)) kept.add(normalized.name);
		else if (!fresh.includes(normalized.name)) fresh.push(normalized.name);
	}
	if (fresh.length === 0) return { fresh, kept };
	const taken = await dnsDomainModel
		.query(trx)
		.joinRelated("credential")
		.where("credential.owner_user_id", credential.owner_user_id)
		.whereNot("npmpro_dns_domain.dns_credential_id", credential.id)
		.whereIn("npmpro_dns_domain.name", fresh)
		.select("npmpro_dns_domain.name", "credential.name as credential_name")
		.orderBy("npmpro_dns_domain.name");
	if (taken.length > 0) {
		const domain = taken.map((row) => row.name).join(", ");
		throw new errs.ValidationError(
			`${domain} is already on the DNS credential '${taken[0].credential_name}'`,
			"error.dns-domain-taken",
			{ values: { domain, credential: taken[0].credential_name } },
		);
	}
	return { fresh, kept };
};

const insertNames = async (credentialId, names, source, trx) => {
	const rows = [];
	for (const name of names) {
		// biome-ignore lint/performance/noAwaitInLoops: one insert after another in the transaction
		rows.push(await dnsDomainModel.query(trx).insertAndFetch({ dns_credential_id: credentialId, name, source }));
	}
	return rows;
};

const listQuery = (access, trx) => {
	const query = dnsDomainModel
		.query(trx)
		.joinRelated("credential")
		.select("npmpro_dns_domain.*")
		.orderBy("npmpro_dns_domain.name", "ASC")
		.orderBy("npmpro_dns_domain.id", "ASC");
	if (ownOnly(access)) query.where("credential.owner_user_id", access.token.getUserId(1));
	return query;
};

const internalDnsDomain = {
	/**
	 * @param   {Access}  access
	 * @param   {{ expand?: string[]|null, query?: string|null }}  [options]
	 * @returns {Promise<Object[]>}
	 */
	getAll: async (access, { expand = null, query = null } = {}) => {
		access.can("certificates:view");
		const rows = listQuery(access);
		if (typeof query === "string" && query !== "") rows.where("npmpro_dns_domain.name", "like", `%${query}%`);
		if (expand?.includes("credential")) rows.withGraphFetched("credential.owner");
		return await rows;
	},

	get: async (access, { id, expand = null }, trx) => {
		access.can("certificates:view");
		const query = listQuery(access, trx).where("npmpro_dns_domain.id", id).first();
		if (expand?.includes("credential")) query.withGraphFetched("credential.owner");
		const row = await query;
		if (!row) throw new errs.ItemNotFoundError(id);
		return row;
	},

	create: async (access, { dns_credential_id: credentialId, names, source = "typed" }) => {
		access.can("certificates:manage");
		const credential = await visibleCredential(access, credentialId);
		const rows = await ownerLock(credential.owner_user_id, () =>
			dnsDomainModel.transaction(async (trx) => {
				// the credential may have gone while this waited for the lock
				await visibleCredential(access, credential.id, trx);
				const stored = new Set(await internalDnsDomain.namesOf(credential.id, trx));
				const { fresh } = await planNames(credential, names, stored, trx);
				return await insertNames(credential.id, fresh, source, trx);
			}),
		);
		if (rows.length > 0) {
			await internalAuditLog.add(access, {
				action: "created",
				object_type: "dns-domain",
				object_id: rows[0].id,
				meta: { names: rows.map((row) => row.name), source, ...credentialMeta(credential) },
			});
		}
		return rows;
	},

	move: async (access, { id, dns_credential_id: targetId }) => {
		access.can("certificates:manage");
		const domain = await internalDnsDomain.get(access, { id });
		const from = await visibleCredential(access, domain.dns_credential_id);
		const to = await visibleCredential(access, targetId);
		if (to.owner_user_id !== from.owner_user_id) {
			throw new errs.ValidationError(
				"A domain moves only to a DNS credential of the same owner",
				"error.dns-domain-other-owner",
			);
		}
		if (to.id === from.id) return domain;
		const saved = await ownerLock(from.owner_user_id, () =>
			dnsDomainModel.transaction(async (trx) => {
				await internalDnsDomain.get(access, { id }, trx);
				return await dnsDomainModel.query(trx).patchAndFetchById(id, { dns_credential_id: to.id });
			}),
		);
		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "dns-domain",
			object_id: id,
			meta: { names: [domain.name], from: credentialMeta(from), to: credentialMeta(to) },
		});
		return saved;
	},

	delete: async (access, { id }) => {
		access.can("certificates:manage");
		const domain = await internalDnsDomain.get(access, { id, expand: ["credential"] });
		await ownerLock(domain.credential.owner_user_id, () => dnsDomainModel.query().deleteById(id));
		await internalAuditLog.add(access, {
			action: "deleted",
			object_type: "dns-domain",
			object_id: id,
			meta: { names: [domain.name], ...credentialMeta(domain.credential) },
		});
		return domain;
	},

	/** @returns {Promise<string[]>}  the names of a credential, sorted */
	namesOf: async (credentialId, trx) => {
		const rows = await dnsDomainModel
			.query(trx)
			.select("name")
			.where("dns_credential_id", credentialId)
			.orderBy("name");
		return rows.map((row) => row.name);
	},

	/** Runs fn under the lock of an owner's domains (a credential save or delete that changes them) */
	withOwnerLock: (ownerUserId, fn) => ownerLock(ownerUserId, fn),

	/**
	 * Sets a credential's domains to names, inside trx; the caller holds the owner's lock (withOwnerLock)
	 *
	 * @returns {Promise<{ added: string[], removed: string[] }>}
	 */
	replaceLocked: async (credential, names, trx) => {
		const rows = await dnsDomainModel.query(trx).where("dns_credential_id", credential.id);
		const { fresh, kept } = await planNames(credential, names, new Set(rows.map((row) => row.name)), trx);
		const removed = rows.filter((row) => !kept.has(row.name));
		if (removed.length > 0) {
			await dnsDomainModel
				.query(trx)
				.whereIn(
					"id",
					removed.map((row) => row.id),
				)
				.delete();
		}
		await insertNames(credential.id, fresh, "typed", trx);
		return { added: fresh, removed: removed.map((row) => row.name) };
	},

	/** Deletes a credential's domains inside trx (SQLite does not run the foreign key's cascade) */
	removeAllLocked: (credentialId, trx) => dnsDomainModel.query(trx).where("dns_credential_id", credentialId).delete(),
};

export default internalDnsDomain;
