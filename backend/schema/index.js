import { readFile } from "node:fs/promises";
import $RefParser from "@apidevtools/json-schema-ref-parser";

let compiledSchema = null;

/** Dereferences the schema once, with the Getting started intro of getting-started.md, and returns the cached result */
const getCompiledSchema = async () => {
	compiledSchema ??= await $RefParser
		.dereference(`${import.meta.dirname}/swagger.json`, { mutateInputSchema: false })
		.then(async (schema) => {
			schema.info.description = await readFile(`${import.meta.dirname}/getting-started.md`, "utf8");
			return schema;
		});
	return compiledSchema;
};

/**
 * Returns the validation schema of a path and method.
 *
 * @param {string} path
 * @param {string} method
 * @returns string|null
 */
const getValidationSchema = (path, method) =>
	compiledSchema?.paths[path]?.[method]?.requestBody?.content?.["application/json"]?.schema ?? null;

const querySchemas = new Map();

/**
 * Returns the query parameters of a path and method as one object schema (no other parameter allowed), built once
 * from the documented parameters so validation and the docs cannot drift.
 *
 * @param {string} path
 * @param {string} method
 * @returns {Object|null}
 */
const getQuerySchema = (path, method) => {
	const key = `${method} ${path}`;
	if (querySchemas.has(key)) return querySchemas.get(key);
	const parameters = compiledSchema?.paths[path]?.[method]?.parameters?.filter((param) => param.in === "query");
	if (!parameters) return null;
	const schema = {
		type: "object",
		additionalProperties: false,
		properties: Object.fromEntries(parameters.map((param) => [param.name, param.schema])),
		required: parameters.filter((param) => param.required).map((param) => param.name),
	};
	querySchemas.set(key, schema);
	return schema;
};

export { getCompiledSchema, getQuerySchema, getValidationSchema };
