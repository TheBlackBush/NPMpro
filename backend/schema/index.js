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

export { getCompiledSchema, getValidationSchema };
