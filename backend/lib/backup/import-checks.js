import common from "../../schema/common.json" with { type: "json" };
import accessListSchema from "../../schema/components/access-list-object.json" with { type: "json" };
import certificateSchema from "../../schema/components/certificate-object.json" with { type: "json" };
import deadHostSchema from "../../schema/components/dead-host-object.json" with { type: "json" };
import dnsCredentialSchema from "../../schema/components/dns-credential-object.json" with { type: "json" };
import proxyHostSchema from "../../schema/components/proxy-host-object.json" with { type: "json" };
import redirectionHostSchema from "../../schema/components/redirection-host-object.json" with { type: "json" };
import streamSchema from "../../schema/components/stream-object.json" with { type: "json" };
import {
	assertConfigFields,
	assertLocations,
	assertPathScheme,
	assertUniqueLocations,
	CONFIG_FIELDS,
} from "../host-config-guard.js";
import { BackupError } from "./format.js";
import { ITEM_TYPES } from "./select.js";

// A page import by a user who is no administrator writes rows only as far as the API would let that user: every row
// it adds or replaces passes the host config guard (raw nginx config and file serving are admin-only) and the field
// patterns of the API schemas, since those values reach the nginx templates as they are.

const WRITES = new Set(["add", "replace"]);
const LOCATION_TABLE = "npmpro_location";
// the host types, the key of their config guard rules and the schema their API create and update use
const HOSTS = {
	proxy_hosts: { guard: "proxy_host", schema: proxyHostSchema },
	redirection_hosts: { guard: "redirection_host", schema: redirectionHostSchema },
	dead_hosts: { guard: "dead_host", schema: deadHostSchema },
	streams: { guard: "stream", schema: streamSchema },
};
const LINKED = {
	certificates: certificateSchema,
	access_lists: accessListSchema,
	dns_credentials: dnsCredentialSchema,
};
const LOCATION_SCHEMA = proxyHostSchema.properties.locations.items;
// the child rows of an access list: their columns and the API schema of each
const ACCESS_CHILDREN = {
	access_list_client: { address: common.properties.address, directive: common.properties.directive },
	access_list_auth: { username: common.properties.access_items.items.properties.username },
};
// certificate domains reach certbot and the host configs: the host domain rule applies to them too
const CERTIFICATE_DOMAINS = common.properties.domain_names;
// the guard's errors, by their translation key, and the field they are about
const GUARD_FIELDS = {
	"error.advanced-config-admin-only": "advanced_config",
	"error.path-scheme-webroot": "forward_host",
	"error.path-scheme-alias-prefix": "path",
};

class FieldError extends Error {
	constructor(field) {
		super(field);
		this.field = field;
	}
}

// a property schema with its $ref followed: "#/..." in its own schema, "../common.json#/..." in common
const resolve = (schema, property) => {
	let current = property;
	for (let depth = 0; current?.$ref && depth < 5; depth++) {
		const [file, pointer] = current.$ref.split("#");
		if (!file)
			current = pointer
				.split("/")
				.filter(Boolean)
				.reduce((node, part) => node?.[part], schema);
		else if (file.endsWith("common.json"))
			current = pointer
				.split("/")
				.filter(Boolean)
				.reduce((node, part) => node?.[part], common);
		else return null;
	}
	return current ?? null;
};

const parseList = (value) => {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
};

const INTEGER_TEXT = /^-?\d+$/u;
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// whether the value has a JSON type the rule allows; a database export holds booleans as 0/1, JSON columns as values
// or text and big integers as text
const typeOf = (value) => {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
};

const hasType = (schema, rule, value) => {
	const alternatives = (rule.anyOf ?? rule.oneOf)?.map((alternative) => resolve(schema, alternative) ?? {});
	if (alternatives) return alternatives.some((alternative) => hasBasicType(alternative, value));
	return hasBasicType(rule, value);
};

// hasType for a rule without alternatives
const hasBasicType = (rule, value) => {
	if (rule.anyOf ?? rule.oneOf) return typeOf(value) !== "undefined";
	if (rule.const !== undefined) return value === rule.const;
	if (rule.type === undefined) return value !== null || rule.enum?.includes(null) === true;
	const types = Array.isArray(rule.type) ? rule.type : [rule.type];
	return types.some((type) => {
		if (type === "null") return value === null;
		if (type === "string") return typeof value === "string";
		if (type === "integer")
			return Number.isInteger(value) || (typeof value === "string" && INTEGER_TEXT.test(value));
		if (type === "number") return typeof value === "number" && Number.isFinite(value);
		if (type === "boolean") return typeof value === "boolean" || value === 0 || value === 1;
		if (type === "array") return Array.isArray(parseList(value));
		if (type === "object") return isPlainObject(parseList(value));
		return false;
	});
};

const fits = (rule, value) => {
	if (rule.enum && !rule.enum.some((allowed) => String(allowed) === String(value))) return false;
	if (rule.type === "integer") {
		const number = Number(value);
		if (!Number.isInteger(number)) return false;
		if (rule.minimum !== undefined && number < rule.minimum) return false;
		return rule.maximum === undefined || number <= rule.maximum;
	}
	if (rule.type !== "string" && !(rule.enum && rule.type === undefined)) return true;
	const text = String(value);
	if (rule.maxLength !== undefined && [...text].length > rule.maxLength) return false;
	return !rule.pattern || new RegExp(rule.pattern, "u").test(text);
};

// raw config fields: blank (null) or text, nothing else, since the guard reads anything else as blank
const RAW_CONFIG = new Set([...Object.values(CONFIG_FIELDS).flat(), "advanced_config"]);

/**
 * Throws a FieldError for the first column of row whose value the schema's property rules refuse: a JSON type the
 * schema does not allow (null only where it allows null, or in a raw config field), then the patterns, enums, lengths
 * and ranges. Read-only properties are left alone; a missing value passes.
 */
const checkSchema = (schema, row, { properties = schema.properties, prefix = "" } = {}) => {
	for (const [name, raw] of Object.entries(properties)) {
		const rule = resolve(schema, raw);
		const value = row[name];
		if (!rule || rule.readOnly || value === undefined) continue;
		if (value === null && RAW_CONFIG.has(name)) continue;
		if (!hasType(schema, rule, value)) throw new FieldError(`${prefix}${name}`);
		if (value === null) continue;
		if (rule.type === "array") {
			const items = resolve(schema, rule.items);
			const list = parseList(value);
			if (items?.type === "string") {
				if (!list.every((item) => typeof item === "string" && fits(items, item))) {
					throw new FieldError(`${prefix}${name}`);
				}
			} else if (items && !list.every((item) => hasType(schema, items, item))) {
				throw new FieldError(`${prefix}${name}`);
			}
		} else if (!fits(rule, value)) {
			throw new FieldError(`${prefix}${name}`);
		}
	}
};

// the host config guard for one row, as for a non-admin create (stored: undefined) or update
const checkGuard = (typeId, row, stored, locations) => {
	const { guard } = HOSTS[typeId];
	for (const field of CONFIG_FIELDS[guard]) {
		if (row[field] === undefined) continue;
		if (row[field] !== null && typeof row[field] !== "string") throw new FieldError(field);
		try {
			assertConfigFields(false, { [field]: row[field] }, stored, [field]);
		} catch {
			throw new FieldError(field);
		}
	}
	if (typeId !== "proxy_hosts") return;
	try {
		assertPathScheme(false, row, stored);
	} catch {
		throw new FieldError("forward_host");
	}
	try {
		assertUniqueLocations(locations);
	} catch {
		throw new FieldError("locations");
	}
	for (const [index, location] of locations.entries()) {
		const config = location.advanced_config;
		if (config !== undefined && config !== null && typeof config !== "string") {
			throw new FieldError(`locations[${index}].advanced_config`);
		}
		try {
			assertLocations(false, [{ ...location }], stored?.locations ?? []);
		} catch (error) {
			throw new FieldError(`locations[${index}].${GUARD_FIELDS[error.message_i18n] ?? "path"}`);
		}
	}
};

const checkRow = ({ typeId, row, data, stored }) => {
	if (Object.hasOwn(HOSTS, typeId)) {
		checkSchema(HOSTS[typeId].schema, row);
		const locations =
			typeId === "proxy_hosts"
				? (data.proxy_hosts?.[LOCATION_TABLE] ?? []).filter(
						(location) => String(location.proxy_host_id) === String(row.id),
					)
				: [];
		for (const [index, location] of locations.entries())
			checkSchema(proxyHostSchema, location, {
				properties: LOCATION_SCHEMA.properties,
				prefix: `locations[${index}].`,
			});
		checkGuard(typeId, row, stored, locations);
		return;
	}
	checkSchema(LINKED[typeId], row);
	if (typeId === "certificates") {
		checkSchema(common, row, { properties: { domain_names: CERTIFICATE_DOMAINS } });
	}
	if (typeId === "access_lists") {
		for (const [table, properties] of Object.entries(ACCESS_CHILDREN)) {
			const children = (data.access_lists?.[table] ?? []).filter(
				(child) => String(child.access_list_id) === String(row.id),
			);
			for (const child of children) checkSchema(common, child, { properties, prefix: `${table}.` });
		}
	}
};

// the instance row a replace overwrites, with a proxy host's locations, for the "keeps the stored value" rules
const storedRow = async (knex, item) => {
	const { table } = ITEM_TYPES[item.target.type];
	const row = await knex(table).where({ id: item.target.id }).first();
	if (row && item.type === "proxy_hosts") {
		row.locations = await knex(LOCATION_TABLE).where({ proxy_host_id: item.target.id }).orderBy("id");
	}
	return row;
};

/**
 * Refuses a non-admin page import whose plan adds or replaces a row with a value the API would refuse that user: raw
 * nginx config, file serving outside /var/www, or a field outside its API schema pattern.
 *
 * @param   {Object}    options
 * @param   {Object}    options.knex  reads the rows a replace overwrites
 * @param   {Object}    options.plan  planMerge() result
 * @param   {Object}    options.data  loadStageData() of the planned types
 * @returns {Promise<void>}  rejects with BackupError("invalid-item") naming the item and the field
 */
const checkPageImport = async ({ knex, plan, data }) => {
	for (const item of plan.items) {
		if (!(WRITES.has(item.action) && (Object.hasOwn(HOSTS, item.type) || Object.hasOwn(LINKED, item.type)))) {
			continue;
		}
		const row = (data[item.type]?.[ITEM_TYPES[item.type].table] ?? []).find(
			(other) => String(other.id) === String(item.id),
		);
		if (!row) continue;
		const stored = item.action === "replace" ? await storedRow(knex, item) : undefined;
		try {
			checkRow({ typeId: item.type, row, data, stored });
		} catch (error) {
			if (!(error instanceof FieldError)) throw error;
			throw new BackupError(
				"invalid-item",
				`${item.label} (#${item.id}) cannot be imported: its ${error.field} is not allowed for a user who is no administrator`,
			);
		}
	}
};

export { checkPageImport };
