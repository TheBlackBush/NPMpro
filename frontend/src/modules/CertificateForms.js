/**
 * The validate functions of the certificate and DNS credential windows, built from the field rules their Formik
 * fields had (also those of the shared DomainNamesField, DNSProviderFields and DnsCredentialSelect), for React Hook
 * Form's resolver
 */
import { fieldsValidate } from "./HookForm.js";

// the backend's rules (lib/dns-credential-values.js, schema max length); url and number were browser checks
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u;
const NUMBER = /^-?\d+(?:\.\d+)?$/u;
const HTTP_PROTOCOL = /^https?:$/u;
const MAX_VALUE = 4096;

/**
 * The rules of DNSProviderFields and its DnsCredentialSelect: a provider, and once one is chosen a saved credential
 * and an optional propagation time of 0 to 7200 seconds (those two fields only exist with a provider)
 *
 * @param   {Object} rules   createValidations(intl)
 * @param   {Object} values
 * @returns {Object}  path -> rule
 */
export const dnsChallengeRules = (rules, values) => ({
	npmproDnsProvider: rules.validateRequired(),
	...(values.npmproDnsProvider
		? {
				npmproDnsCredentialId: rules.validateRequired(),
				npmproPropagationSeconds: rules.validateInteger({ min: 0, max: 7200 }),
			}
		: {}),
});

/**
 * Let's Encrypt over HTTP: certificate domain names without wildcards
 */
export const httpCertificateValidate = (rules) => fieldsValidate({ domainNames: rules.validateDomains(false, true) });

/**
 * Let's Encrypt over DNS: certificate domain names with wildcards, then the DNS challenge fields
 */
export const dnsCertificateValidate = (rules) =>
	fieldsValidate((values) => ({
		domainNames: rules.validateDomains(true, true),
		...dnsChallengeRules(rules, values),
	}));

/**
 * A custom (or mTLS CA) certificate: the name only when it is created (it cannot be renamed), the certificate file,
 * and the key file unless it is an mTLS CA
 *
 * @param   {Object} rules
 * @param   {{ isEdit: boolean, isMtls: boolean }} options
 * @returns {Function}
 */
export const customCertificateValidate = (rules, { isEdit, isMtls }) =>
	fieldsValidate({
		niceName: isEdit ? undefined : rules.validateString(1, 255),
		certificate: rules.validateFile(),
		certificateKey: isMtls ? undefined : rules.validateFile(),
	});

/**
 * Change the DNS credential of a certificate: one must be chosen
 */
export const changeDnsCredentialValidate = (rules) =>
	fieldsValidate({ npmproDnsCredentialId: rules.validateRequired() });

/**
 * One provider field of a DNS credential: required unless optional or a saved secret is kept, at most 4096
 * characters, no control characters, an http(s) URL or a number where the provider says so
 *
 * @param   {Object}  rules
 * @param   {Object}  definition  the provider's field ({ key, type, optional })
 * @param   {boolean} saved       a saved secret: empty keeps it
 * @returns {Function}
 */
export const credentialValueRule = (rules, definition, saved) => (raw) => {
	const value = String(raw ?? "").trim();
	if (value === "") return definition.optional || saved ? undefined : rules.message("error.required");
	if (value.length > MAX_VALUE) return rules.message("error.max-character-length", { max: MAX_VALUE });
	if (CONTROL_CHARS.test(value)) return rules.message("dns-credentials.value.control-chars");
	if (definition.type === "url" && !(URL.canParse(value) && HTTP_PROTOCOL.test(new URL(value).protocol))) {
		return rules.message("dns-credentials.value.url");
	}
	if (definition.type === "number" && !NUMBER.test(value)) return rules.message("dns-credentials.value.number");
};

/**
 * The INI text of a DNS credential, required unless one is saved
 */
export const iniRule = (rules, credential) => (value) =>
	String(value ?? "").trim() === "" && !credential?.iniSet ? rules.message("error.required") : undefined;

/**
 * The DNS credential window: the name (1 to 255), a provider, then what the window shows for it: the INI text (a
 * provider without field definitions, or INI chosen) or the fields of the chosen group. The saved credential counts
 * only while its own provider is chosen, as in the window.
 *
 * @param   {Object} rules
 * @param   {{ providers: Object[], credential: Object }} options  the provider list and the loaded credential
 * @returns {Function}
 */
export const dnsCredentialValidate = (rules, { providers, credential }) =>
	fieldsValidate(
		(values) => {
			const fieldRules = { name: rules.validateString(1, 255) };
			const provider = providers.find((p) => p.id === values.provider);
			if (!provider) return fieldRules;
			const saved = credential?.provider === values.provider ? credential : null;
			if (!provider.fields || values.useIni) return { ...fieldRules, ini: iniRule(rules, saved) };
			const savedKeys = new Set((saved?.fields ?? []).filter((f) => f.isSet).map((f) => f.key));
			for (const definition of provider.fields.filter((f) => !f.group || f.group === values.oneOfGroup)) {
				fieldRules[`fieldValues.${definition.key}`] = credentialValueRule(
					rules,
					definition,
					definition.type === "secret" && savedKeys.has(definition.key),
				);
			}
			return fieldRules;
		},
		(values) => (values.provider ? {} : { provider: rules.message("error.required") }),
	);

/**
 * The starting values of a DNS credential's provider fields: every field of the provider, with its saved value or
 * empty (a saved secret is never sent back, so it starts empty: empty keeps it)
 *
 * @param   {Object|undefined} provider
 * @param   {Object|null}      credential  the loaded credential while it has this provider
 * @returns {Object}  key -> value
 */
export function credentialFieldValues(provider, credential) {
	const saved = new Map((credential?.fields ?? []).map((f) => [f.key, f.value]));
	return Object.fromEntries((provider?.fields ?? []).map((f) => [f.key, saved.get(f.key) ?? ""]));
}
