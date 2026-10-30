import { intl } from "src/locale";
import { createValidations } from "./ValidationRules";

// the field rules with the app's messages (the rules themselves live in ValidationRules.js, so node --test runs them)
const validations = createValidations(intl);

const {
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
} = validations;

export { HOST_PATTERN, upstreamUrlPattern } from "./ValidationRules";
export {
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
	validations,
};
