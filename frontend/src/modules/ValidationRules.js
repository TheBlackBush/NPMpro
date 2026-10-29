/**
 * The field rules of the forms (formerly the body of Validations.jsx), built for one react-intl object so they run
 * in node --test with the English messages. Validations.jsx builds them once with the app's intl.
 */

// an address with one @ and no spaces (what type="email" checked before the forms used noValidate)
const emailPattern = /^[^\s@]+@[^\s@]+$/u;
// the backend's rule (schema/common.json): a name that is not a regular expression has no nginx syntax characters
const domainPattern = /^(?:~\S{0,252}|(?!.*:[0-9]+$)[^\s/;{}"'\\#]{1,253})$/u;
const DIGITS = /^\d+$/u;
const certificateHttpDomainPattern =
	/^(?:(?:[\p{L}\p{Mn}\p{Mc}\p{Nd}-]+\.)+[\p{L}\p{Mn}\p{Mc}\p{Nd}-]+|\[[0-9a-fA-F:]+\])$/u;
const certificateDnsDomainPattern =
	/^(?![0-9.]+$)(?:\*\.)?(?:[\p{L}\p{Mn}\p{Mc}\p{Nd}-]+\.)+[\p{L}\p{Mn}\p{Mc}\p{Nd}-]+$/u;
// a forward host or domain: the backend's rule (no whitespace or nginx syntax characters)
export const HOST_PATTERN = /^[^\s;{}"'\\#]+$/u;
// the same rule as the backend (no whitespace or nginx syntax characters)
export const upstreamUrlPattern =
	/^https?:\/\/(?:(?:[^\s/:;{}#"'$\\]+|\[[a-fA-F0-9:]+\]):[0-9]+|cu_[^\s/:;{}#"'$\\]+)$/u;

// the backend's upload limit (routes/nginx/certificates.js)
const MAX_UPLOAD_BYTES = 1024 * 1024;

/**
 * Every field rule, with its messages translated by intl
 *
 * @param   {{ formatMessage: Function }} intl  a react-intl intl object
 * @returns {Object}
 */
export function createValidations(intl) {
	const message = (id, data) => intl.formatMessage({ id }, data);

	const validateString =
		(minLength = 0, maxLength = 0, trim = true) =>
		(value) => {
			const text = String(value ?? "");
			const { length } = trim ? text.trim() : text;
			if (minLength && length === 0) {
				return message("error.required");
			}
			if (length < minLength) {
				return message("error.min-character-length", { min: minLength });
			}
			if (maxLength && length > maxLength) {
				return message("error.max-character-length", { max: maxLength });
			}
		};

	const validateNumber =
		(min = -1, max = -1) =>
		(value) => {
			const int = Number(value);
			if (min > -1 && !int) {
				return message("error.required");
			}
			if (min > -1 && int < min) {
				return message("error.minimum", { min });
			}
			if (max > -1 && int > max) {
				return message("error.maximum", { max });
			}
		};

	/**
	 * Text with an optional pattern: required (not blank), length and the pattern, checked on the trimmed value
	 */
	const validateText =
		({ required = false, max = 0, pattern, messageId = "error.invalid-value", data } = {}) =>
		(value) => {
			const text = String(value ?? "").trim();
			if (text === "") return required ? message("error.required") : undefined;
			if (max && text.length > max) return message("error.max-character-length", { max });
			if (pattern && !pattern.test(text)) return message(messageId, data);
		};

	/**
	 * A whole number from min to max (digits only), empty allowed unless required
	 */
	const validateInteger =
		({ required = false, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) =>
		(value) => {
			const text = String(value ?? "").trim();
			if (text === "") return required ? message("error.required") : undefined;
			const number = DIGITS.test(text) ? Number(text) : Number.NaN;
			if (!(number >= min && number <= max)) return message("error.number-range", { min, max });
		};

	/**
	 * A value that is not text: a selected id, a file, a list; empty, null, 0 or an empty list counts as missing
	 */
	const validateRequired =
		(messageId = "error.required") =>
		(value) => {
			const missing = value === undefined || value === null || value === "" || value === 0 || value?.length === 0;
			return missing ? message(messageId) : undefined;
		};

	/**
	 * At most max bytes in UTF-8 (bcrypt reads only the first 72 bytes of a password)
	 */
	const validateByteLength = (max) => (value) =>
		new TextEncoder().encode(String(value ?? "")).length > max
			? message("error.max-byte-length", { max })
			: undefined;

	/**
	 * A chosen file: required, at most maxBytes
	 */
	const validateFile =
		({ required = true, maxBytes = MAX_UPLOAD_BYTES } = {}) =>
		(file) => {
			if (!file) return required ? message("error.required") : undefined;
			if (file.size > maxBytes) return message("error.max-upload-size");
		};

	const validateEmail = () => (value) => {
		if (value.length === 0) {
			return message("error.required");
		}
		if (value.length < 3 || !emailPattern.test(value)) {
			return message("error.invalid-email");
		}
		if (value.length > 255) {
			return message("error.max-character-length", { max: 255 });
		}
	};

	const validateDomain = (allowWildcards, forCertificate) => (input) => {
		const domain = input.trim();
		if (!forCertificate) return domainPattern.test(domain);
		return (
			[...domain].length <= 253 &&
			(allowWildcards ? certificateDnsDomainPattern : certificateHttpDomainPattern).test(domain)
		);
	};

	const validateDomains = (allowWildcards, forCertificate) => {
		const vDom = validateDomain(allowWildcards, forCertificate);
		const maxDomains = forCertificate ? 25 : 100;

		return (value) => {
			if (!value?.length) {
				return message("error.required");
			}

			if (value.length > maxDomains) {
				return message("error.max-domains", { max: maxDomains });
			}

			// validate each domain
			for (const domain of value) {
				if (!vDom(domain)) {
					return message("error.invalid-domain", { domain });
				}
			}
		};
	};

	const validateUpstreamUrl = () => (value) => {
		if (value && !upstreamUrlPattern.test(value)) {
			return message("error.invalid-upstream-url");
		}
	};

	return {
		message,
		validateByteLength,
		validateDomain,
		validateDomains,
		validateEmail,
		validateFile,
		validateInteger,
		validateNumber,
		validateRequired,
		validateString,
		validateText,
		validateUpstreamUrl,
	};
}
