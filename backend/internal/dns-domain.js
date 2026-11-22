import { ownerLock } from "../lib/dns-domain-lock.js";
import { nameSearch, normalizeDomainName } from "../lib/dns-domain-name.js";
import errs from "../lib/error.js";
import dnsCredentialModel from "../models/dns_credential.js";
import dnsDomainModel from "../models/dns_domain.js";
import internalAuditLog from "./audit-log.js";

// The DNS domains (zones) of the DNS credentials; the writer of npmpro_dns_domain besides a backup restore or merge.
// Every change of an owner's domains runs under that owner's lock (lib/dns-domain-lock.js).

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
		const [holder, ...others] = [...new Set(taken.map((row) => row.credential_name))];
		if (others.length === 0) {
			throw new errs.ValidationError(
				`${domain} is already on the DNS credential '${holder}'`,
				"error.dns-domain-taken",
				{ values: { domain, credential: holder } },
			);
		}
		throw new errs.ValidationError(
			`${domain} is already on the DNS credential '${holder}' and ${others.length} more`,
			"error.dns-domain-taken-more",
			{ values: { domain, credential: holder, count: others.length } },
		);
	}
	return { fresh, kept };
};

const insertNames = async (credentialId, names, source, trx) => {
	const rows = [];
	for (const name of names) {
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
		if (typeof query === "string" && query !== "") {
			const { sql, bindings } = nameSearch(query);
			rows.whereRaw(sql, bindings);
		}
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
		// both credentials and the domain are read again under the lock: a save or delete of a credential, or another
		// move, may have run while this waited
		const moved = await ownerLock(from.owner_user_id, () =>
			dnsDomainModel.transaction(async (trx) => {
				const fresh = await internalDnsDomain.get(access, { id }, trx);
				const newTo = await visibleCredential(access, to.id, trx);
				const oldFrom = await visibleCredential(access, fresh.dns_credential_id, trx);
				if (newTo.owner_user_id !== oldFrom.owner_user_id) {
					throw new errs.ValidationError(
						"A domain moves only to a DNS credential of the same owner",
						"error.dns-domain-other-owner",
					);
				}
				if (newTo.id === oldFrom.id) return { saved: fresh, source: oldFrom, target: newTo };
				const patched = await dnsDomainModel.query(trx).patchAndFetchById(id, { dns_credential_id: newTo.id });
				return { saved: patched, source: oldFrom, target: newTo };
			}),
		);
		const { saved, source, target } = moved;
		if (target.id === source.id) return saved;
		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "dns-domain",
			object_id: id,
			meta: { names: [domain.name], from: credentialMeta(source), to: credentialMeta(target) },
		});
		return saved;
	},

	delete: async (access, { id }) => {
		access.can("certificates:manage");
		const domain = await internalDnsDomain.get(access, { id, expand: ["credential"] });
		await ownerLock(domain.credential.owner_user_id, async () => {
			// the domain may have gone with its credential while this waited for the lock
			const gone = await dnsDomainModel.query().deleteById(id);
			if (gone === 0) throw new errs.ItemNotFoundError(id);
		});
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
