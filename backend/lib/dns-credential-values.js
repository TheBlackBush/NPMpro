import dnsFields from "../certbot/dns-fields.json" with { type: "json" };
import errs from "./error.js";

const lineBreakPattern = /[\r\n]/u;

/**
 * @param   {String}  provider
 * @returns {Object|null}
 */
const getFieldDefinition = (provider) => dnsFields[provider] ?? null;

const isFilled = (fields, key) => typeof fields[key] === "string" && fields[key] !== "";

const checkGroups = (def, fields) => {
	const groupFields = (group) => def.fields.filter((field) => field.group === group && !field.optional);
	const filledGroups = def.one_of.filter((group) => groupFields(group).some((field) => isFilled(fields, field.key)));
	if (filledGroups.length !== 1) {
		const names = def.one_of
			.map((group) =>
				groupFields(group)
					.map((field) => field.label)
					.join(" + "),
			)
			.join(" or ");
		throw new errs.ValidationError(`Fill in exactly one of: ${names}`);
	}
	return filledGroups[0];
};

const buildFields = (provider, def, input, previous) => {
	const known = new Map(def.fields.map((field) => [field.key, field]));
	const fields = {};
	for (const { key, value } of input) {
		if (!known.has(key)) throw new errs.ValidationError(`Unknown field ${key} for DNS provider ${provider}`);
		const text = String(value ?? "").trim();
		if (lineBreakPattern.test(text))
			throw new errs.ValidationError(`${known.get(key).label} must not contain a line break`);
		if (text !== "") fields[key] = text;
	}

	// an empty secret keeps its saved value
	for (const field of def.fields) {
		if (field.type === "secret" && !isFilled(fields, field.key) && isFilled(previous, field.key)) {
			fields[field.key] = previous[field.key];
		}
	}

	const activeGroup = def.one_of ? checkGroups(def, fields) : null;
	for (const field of def.fields) {
		if (field.group && activeGroup && field.group !== activeGroup) {
			delete fields[field.key];
			continue;
		}
		if (!field.optional && !isFilled(fields, field.key)) {
			throw new errs.ValidationError(`${field.label} is required`);
		}
	}

	// keep definition order, it is also the INI order
	return Object.fromEntries(
		def.fields.filter((field) => isFilled(fields, field.key)).map((field) => [field.key, fields[field.key]]),
	);
};

/**
 * Builds the values to store from the API input. Secrets left empty keep the previous value of the same provider.
 *
 * @param   {String}       provider
 * @param   {Object}       input            { fields?: [{ key, value }], ini?: String }
 * @param   {Object|null}  previous         stored values of the same credential and provider, or null
 * @returns {Object}                        { fields: { key: value } } or { ini: String }
 */
const buildValues = (provider, input, previous) => {
	const hasFields = Array.isArray(input.fields);
	const hasIni = typeof input.ini === "string";
	if (hasFields && hasIni) throw new errs.ValidationError("Send either fields or ini, not both");

	if (hasIni) {
		const ini = input.ini.trim();
		if (ini !== "") return { ini };
		if (previous?.ini) return { ini: previous.ini };
		throw new errs.ValidationError("DNS provider credentials are required");
	}

	const def = getFieldDefinition(provider);
	if (!def) throw new errs.ValidationError(`DNS provider ${provider} has no field definition, send ini instead`);
	return { fields: buildFields(provider, def, input.fields ?? [], previous?.fields ?? {}) };
};

/**
 * @param   {Object}  values
 * @returns {String}  certbot credentials file content
 */
const toIni = (values) => {
	if (typeof values.ini === "string") return `${values.ini}\n`;
	return Object.entries(values.fields)
		.map(([key, value]) => `${key} = ${value}\n`)
		.join("");
};

/**
 * What the API may show: non-secret values and whether each field is set. Never secret values or INI text.
 *
 * @param   {String}       provider
 * @param   {Object|null}  values    null when the stored values cannot be decrypted
 * @returns {Object}
 */
const publicView = (provider, values) => {
	const stored = values?.fields ?? {};
	const fields = (getFieldDefinition(provider)?.fields ?? []).map((field) => {
		const isSet = isFilled(stored, field.key);
		return field.type === "secret" || !isSet
			? { key: field.key, is_set: isSet }
			: { key: field.key, value: stored[field.key], is_set: true };
	});
	return { fields, ini_set: typeof values?.ini === "string" && values.ini !== "" };
};

export { buildValues, getFieldDefinition, publicView, toIni };
