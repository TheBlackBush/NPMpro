import $RefParser from "@apidevtools/json-schema-ref-parser";

let compiledSchema = null;

/** Dereferences the schema once and returns the cached result */
const getCompiledSchema = async () => {
	compiledSchema ??= await $RefParser.dereference(`${import.meta.dirname}/swagger.json`, {
		mutateInputSchema: false,
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
