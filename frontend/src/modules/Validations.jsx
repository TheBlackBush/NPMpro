import { intl } from "src/locale";

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
const HOST_PATTERN = /^[^\s;{}"'\\#]+$/u;
// the same rule as the backend (no whitespace or nginx syntax characters)
const upstreamUrlPattern = /^https?:\/\/(?:(?:[^\s/:;{}#"'$\\]+|\[[a-fA-F0-9:]+\]):[0-9]+|cu_[^\s/:;{}#"'$\\]+)$/u;

const validateString =
	(minLength = 0, maxLength = 0, trim = true) =>
	(value) => {
		const text = String(value ?? "");
		const { length } = trim ? text.trim() : text;
		if (minLength && length === 0) {
			return intl.formatMessage({ id: "error.required" });
		}
		if (length < minLength) {
			return intl.formatMessage({ id: "error.min-character-length" }, { min: minLength });
		}
		if (maxLength && length > maxLength) {
			return intl.formatMessage({ id: "error.max-character-length" }, { max: maxLength });
		}
	};

const validateNumber =
	(min = -1, max = -1) =>
	(value) => {
		const int = Number(value);
		if (min > -1 && !int) {
			return intl.formatMessage({ id: "error.required" });
		}
		if (min > -1 && int < min) {
			return intl.formatMessage({ id: "error.minimum" }, { min });
		}
		if (max > -1 && int > max) {
			return intl.formatMessage({ id: "error.maximum" }, { max });
		}
	};

/**
 * Text with an optional pattern: required (not blank), length and the pattern, checked on the trimmed value
 *
 * @param {Object}  options
 * @param {boolean} [options.required]
 * @param {number}  [options.max]        characters
 * @param {RegExp}  [options.pattern]
 * @param {string}  [options.messageId]  the message when the pattern does not match
 * @param {Object}  [options.data]       values for that message
 */
const validateText =
	({ required = false, max = 0, pattern, messageId = "error.invalid-value", data } = {}) =>
	(value) => {
		const text = String(value ?? "").trim();
		if (text === "") return required ? intl.formatMessage({ id: "error.required" }) : undefined;
		if (max && text.length > max) return intl.formatMessage({ id: "error.max-character-length" }, { max });
		if (pattern && !pattern.test(text)) return intl.formatMessage({ id: messageId }, data);
	};

/**
 * A whole number from min to max (digits only), empty allowed unless required
 */
const validateInteger =
	({ required = false, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) =>
	(value) => {
		const text = String(value ?? "").trim();
		if (text === "") return required ? intl.formatMessage({ id: "error.required" }) : undefined;
		const number = DIGITS.test(text) ? Number(text) : Number.NaN;
		if (!(number >= min && number <= max)) return intl.formatMessage({ id: "error.number-range" }, { min, max });
	};

/**
 * A value that is not text: a selected id, a file, a list; empty, null, 0 or an empty list counts as missing
 */
const validateRequired =
	(messageId = "error.required") =>
	(value) => {
		const missing = value === undefined || value === null || value === "" || value === 0 || value?.length === 0;
		return missing ? intl.formatMessage({ id: messageId }) : undefined;
	};

/**
 * At most max bytes in UTF-8 (bcrypt reads only the first 72 bytes of a password)
 */
const validateByteLength = (max) => (value) =>
	new TextEncoder().encode(String(value ?? "")).length > max
		? intl.formatMessage({ id: "error.max-byte-length" }, { max })
		: undefined;

// the backend's upload limit (routes/nginx/certificates.js)
const MAX_UPLOAD_BYTES = 1024 * 1024;

/**
 * A chosen file: required, at most maxBytes
 */
const validateFile =
	({ required = true, maxBytes = MAX_UPLOAD_BYTES } = {}) =>
	(file) => {
		if (!file) return required ? intl.formatMessage({ id: "error.required" }) : undefined;
		if (file.size > maxBytes) return intl.formatMessage({ id: "error.max-upload-size" });
	};

const validateEmail = () => (value) => {
	if (value.length === 0) {
		return intl.formatMessage({ id: "error.required" });
	}
	if (value.length < 3 || !emailPattern.test(value)) {
		return intl.formatMessage({ id: "error.invalid-email" });
	}
	if (value.length > 255) {
		return intl.formatMessage({ id: "error.max-character-length" }, { max: 255 });
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
			return intl.formatMessage({ id: "error.required" });
		}

		if (value.length > maxDomains) {
			return intl.formatMessage({ id: "error.max-domains" }, { max: maxDomains });
		}

		// validate each domain
		for (const domain of value) {
			if (!vDom(domain)) {
				return intl.formatMessage({ id: "error.invalid-domain" }, { domain });
			}
		}
	};
};

const validateUpstreamUrl = () => (value) => {
	if (value && !upstreamUrlPattern.test(value)) {
		return intl.formatMessage({ id: "error.invalid-upstream-url" });
	}
};

export {
	HOST_PATTERN,
	upstreamUrlPattern,
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
