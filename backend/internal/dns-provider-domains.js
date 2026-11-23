import { providerFetch } from "../lib/ddns/provider-fetch.js";
import { providerForCredential } from "../lib/ddns/providers/index.js";
import { credentialFields, secretValuesOf } from "../lib/dns-credential-values.js";
import { normalizeDomainName } from "../lib/dns-domain-name.js";
import errs from "../lib/error.js";
import { defaultSecretBox, SecretBoxError } from "../lib/secret-box.js";
import dnsDomainModel from "../models/dns_domain.js";
import internalDnsCredential from "./dns-credential.js";

// The zones a provider lists for a DNS credential, each marked against the owner's stored domains. Nothing is
// written here: the Fetch domains window adds the chosen names through the domains API.

const openValues = (row) => {
	try {
		return defaultSecretBox.decrypt(row.values);
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
};

// a provider failure as a public 400 the UI translates; the message is already scrubbed of the secrets
const refused = (error, provider) => {
	if (error.code === "forbidden") {
		return new errs.ValidationError(error.message, "error.dns-zones-forbidden", {
			values: { message: error.message, provider: provider.label, ...(error.hint ? { hint: error.hint } : {}) },
			cause: error,
		});
	}
	if (error.code === "blocked" || error.code === "not-https") {
		return new errs.ValidationError(error.message, "error.dns-zones-blocked", { cause: error });
	}
	return new errs.ValidationError(error.message, "error.dns-zones-failed", {
		values: { message: error.message },
		cause: error,
	});
};

// the zone names against the domains of the credential's owner: here (this credential), other (another credential
// of the same owner, named) or new
const markZones = async (row, names) => {
	const stored = await dnsDomainModel
		.query()
		.joinRelated("credential")
		.where("credential.owner_user_id", row.owner_user_id)
		.select("npmpro_dns_domain.name", "npmpro_dns_domain.dns_credential_id", "credential.name as credential_name");
	const byName = new Map(stored.map((domain) => [domain.name, domain]));
	return names.map((name) => {
		const normalized = normalizeDomainName(name);
		const found = "name" in normalized ? byName.get(normalized.name) : undefined;
		if (!found) return { name, state: "new" };
		if (found.dns_credential_id === row.id) return { name, state: "here" };
		return { name, state: "other", credential_name: found.credential_name };
	});
};

const internalDnsProviderDomains = {
	/**
	 * @param   {Access}  access
	 * @param   {{ id: number }}  data  the credential id
	 * @returns {Promise<{ supported: boolean, truncated: boolean, zones: Object[] }>}
	 */
	get: async (access, { id }) => {
		access.can("certificates:manage");
		const row = await internalDnsCredential.get(access, { id });
		const provider = providerForCredential(row.provider);
		if (provider === null) return { supported: false, truncated: false, zones: [] };
		const fields = credentialFields(openValues(row));
		const secrets = secretValuesOf(row.provider, fields);
		let names;
		try {
			names = await provider.listZones({
				fields,
				fetch: (url, options) => providerFetch(url, { ...options, secrets }),
			});
		} catch (error) {
			if (error?.name === "DdnsProviderError") throw refused(error, provider);
			throw error;
		}
		return { supported: true, truncated: names.truncated === true, zones: await markZones(row, [...names]) };
	},
};

export default internalDnsProviderDomains;
