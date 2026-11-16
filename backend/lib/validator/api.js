import Ajv from "ajv/dist/2020.js";
import errs from "../error.js";

const ajv = new Ajv({
	verbose: true,
	allowUnionTypes: true,
	strict: false,
	coerceTypes: true,
});

const untrimmedPaths = new Set([
	"/secret",
	"/license_key",
	"/ini",
	"/current",
	"/auth/secret",
	"/items/username",
	"/items/password",
	"/advanced_config",
	"/passphrase",
	"/npmpro_advanced_config",
	"/npmpro_location_config",
	"/locations/advanced_config",
	"/locations/location_type",
	"/meta/html",
	"/client_secret",
	"/password",
	"/npmpro_page_not_found_html",
	"/npmpro_page_upstream_html",
	"/npmpro_page_maintenance_html",
	"/npmpro_page_html",
	"/npmpro_denied_page_html",
	"/default_site/meta/html",
	"/pages/not_found/html",
	"/pages/upstream_error/html",
	"/pages/denied/html",
	"/pages/maintenance/html",
	"/pages/certificate/html",
	"/pages/ban/html",
	"/pages/captcha/html",
]);

// errors that name the value the user sent, by the path of the value
const TAG_ITEM = /^\/npmpro_tags\/\d+$/u;
const valueMessages = [
	{
		path: TAG_ITEM,
		message: (value) =>
			`The tag "${value}" is not valid: a tag has 1 to 32 letters, digits, spaces, "-", "_" or "." and no space at either end.`,
	},
];

// the message of the first error: a value message when one names its path, else AJV's
const messageOf = (errors) => {
	const [first] = errors;
	const named = valueMessages.find(({ path }) => path.test(first.instancePath));
	return named && typeof first.data === "string" ? named.message(first.data) : ajv.errorsText(errors);
};

const trimStrings = (value, path = "", depth = 0) => {
	if (depth > 8) throw new errs.ValidationError("Payload is nested too deeply");
	if (typeof value === "string") return untrimmedPaths.has(path) ? value : value.trim();
	if (Array.isArray(value)) return value.map((item) => trimStrings(item, path, depth + 1));
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, trimStrings(item, `${path}/${key}`, depth + 1)]),
	);
};

/**
 * @param {Object} schema
 * @param {Object} payload
 * @returns {Promise}
 */
const apiValidator = (schema, payload /*, description*/) => {
	if (!schema) {
		throw new errs.ValidationError("Schema is undefined");
	}

	// Can't use falsy check here as valid payload could be `0` or `false`
	if (payload === undefined) throw new errs.ValidationError("Payload is undefined");

	const validate = ajv.compile(schema);

	const data = trimStrings(payload);

	if (validate(data)) return data;

	const message = messageOf(validate.errors);
	const err = new errs.ValidationError(message);
	err.debug = { validationErrors: validate.errors, payload };
	throw err;
};

export default apiValidator;
