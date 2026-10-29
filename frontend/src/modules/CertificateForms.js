/**
 * The validate functions of the certificate and DNS credential windows, built from the field rules their Formik
 * fields had (also those of the shared DomainNamesField, DNSProviderFields and DnsCredentialSelect), for React Hook
 * Form's resolver
 */
import { fieldsValidate } from "./HookForm.js";

/**
 * The rules of DNSProviderFields and its DnsCredentialSelect: a provider, and once one is chosen a saved credential
 * and an optional propagation time of 0 to 7200 seconds (those two fields only exist with a provider)
 *
 * @param   {Object} rules   createValidations(intl)
 * @param   {Object} values
 * @returns {Object}  path -> rule
 */
const dnsChallengeRules = (rules, values) => ({
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
