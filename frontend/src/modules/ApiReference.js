const METHODS = ["get", "post", "put", "patch", "delete"];

/**
 * Splits the Needs line (the last line, starting with "Needs: ") off an operation description
 *
 * @param {string | undefined} description
 * @returns {{ text: string, needs: string | null }}
 */
const splitNeeds = (description) => {
	const lines = (description ?? "").split("\n");
	const last = lines.length - 1;
	if (lines[last].startsWith("Needs: ")) {
		return { text: lines.slice(0, last).join("\n").trimEnd(), needs: lines[last].slice("Needs: ".length) };
	}
	return { text: lines.join("\n"), needs: null };
};

/**
 * A path as anchor text: lower case, braces dropped, other runs become one dash
 *
 * @param {string} path
 * @returns {string} "root" for an empty result
 */
const slugOf = (path) =>
	path
		.toLowerCase()
		.replace(/[{}]/gu, "")
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "") || "root";

/**
 * The anchor of a route: "<tag>/<method>-<slug>"
 *
 * @param {string} tag
 * @param {string} method
 * @param {string} path
 * @returns {string}
 */
const anchorOf = (tag, method, path) => `${tag}/${method.toLowerCase()}-${slugOf(path)}`;

/**
 * The type of a schema as the reference shows it
 *
 * @param {object | undefined} schema
 * @returns {string}
 */
const typeLabel = (schema) => {
	if (!schema) {
		return "any";
	}
	if (schema.enum) {
		return schema.enum.map((value) => (typeof value === "string" ? `"${value}"` : String(value))).join(" | ");
	}
	if (Object.hasOwn(schema, "const")) {
		return typeof schema.const === "string" ? `"${schema.const}"` : String(schema.const);
	}
	const branches = schema.oneOf ?? schema.anyOf;
	if (branches) {
		return branches.map(typeLabel).join(" | ");
	}
	if (Array.isArray(schema.type)) {
		const names = schema.type.filter((name) => name !== "null");
		return (schema.type.includes("null") ? [...names, "null"] : names).join(" | ");
	}
	if (schema.type === "array") {
		return `array of ${typeLabel(schema.items)}`;
	}
	if (schema.type) {
		return schema.type;
	}
	return schema.properties ? "object" : "any";
};

/**
 * The properties of a schema, those of every oneOf or anyOf branch once (the first branch wins on a name clash)
 *
 * @param {object | undefined} schema
 * @returns {Map<string, { schema: object, required: boolean }>}
 */
const propertiesOf = (schema) => {
	const found = new Map();
	if (!schema) {
		return found;
	}
	for (const [name, property] of Object.entries(schema.properties ?? {})) {
		found.set(name, { schema: property, required: (schema.required ?? []).includes(name) });
	}
	for (const branch of schema.oneOf ?? schema.anyOf ?? []) {
		for (const [name, entry] of propertiesOf(branch)) {
			if (!found.has(name)) {
				found.set(name, entry);
			}
		}
	}
	return found;
};

/**
 * One row per field of an object schema, nested fields after their parent as "parent.child" and "parent[].child"
 *
 * @param {object | undefined} schema
 * @param {number} [maxDepth] levels shown, the first is 1
 * @returns {Array<{ name: string, type: string, required: boolean, description: string, depth: number }>}
 */
const fieldRows = (schema, maxDepth = 3) => {
	const rows = [];
	const walk = (parent, prefix, depth) => {
		for (const [key, { schema: property, required }] of propertiesOf(parent)) {
			const name = `${prefix}${key}`;
			rows.push({ name, type: typeLabel(property), required, description: property.description ?? "", depth });
			if (depth < maxDepth) {
				if (property.type === "array") {
					walk(property.items, `${name}[].`, depth + 1);
				} else {
					walk(property, `${name}.`, depth + 1);
				}
			}
		}
	};
	walk(schema, "", 1);
	return rows;
};

/**
 * The example of a media type object
 *
 * @param {object | undefined} media
 * @returns {unknown | undefined}
 */
const exampleOf = (media) => {
	const named = Object.values(media?.examples ?? {});
	if (media?.examples?.default) {
		return media.examples.default.value;
	}
	if (named.length > 0) {
		return named[0].value;
	}
	return media?.example;
};

/**
 * Who can call an operation
 *
 * @param {object} operation
 * @returns {"public" | "session" | "token"}
 */
const authOf = (operation) => {
	const entries = operation.security ?? [];
	if (entries.length === 0) {
		return "public";
	}
	return entries.some((entry) => "bearerAuth" in entry) ? "token" : "session";
};

const buildBody = (requestBody) => {
	if (!requestBody) {
		return null;
	}
	const [mediaType, media] = Object.entries(requestBody.content ?? {})[0] ?? [];
	return {
		mediaType: mediaType ?? null,
		schema: media?.schema,
		fields: fieldRows(media?.schema),
		example: exampleOf(media),
		tryable: mediaType === undefined || mediaType === "application/json",
	};
};

const buildResponses = (responses) =>
	Object.entries(responses ?? {})
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([status, response]) => {
			const [mediaType, media] = Object.entries(response.content ?? {})[0] ?? [];
			return {
				status,
				description: response.description ?? "",
				mediaType: mediaType ?? null,
				example: exampleOf(media),
			};
		});

const buildOperation = (tag, method, path, operation) => {
	const { text, needs } = splitNeeds(operation.description);
	return {
		anchor: anchorOf(tag, method, path),
		tag,
		method: method.toUpperCase(),
		path,
		operationId: operation.operationId,
		summary: operation.summary ?? "",
		text,
		needs,
		auth: authOf(operation),
		params: (operation.parameters ?? [])
			.filter((param) => param.in === "path" || param.in === "query")
			.map((param) => ({
				name: param.name,
				in: param.in,
				required: param.required === true,
				type: typeLabel(param.schema),
				description: param.description ?? "",
				example: param.example ?? param.schema?.example,
			})),
		body: buildBody(operation.requestBody),
		responses: buildResponses(operation.responses),
	};
};

/**
 * The view model of the API reference page, built from the compiled OpenAPI schema
 *
 * @param {object} schema
 * @returns {{ title: string, version: string, guide: string, groups: Array<{ name: string, intro: string, operations: object[] }> }}
 */
const buildReference = (schema) => {
	const byTag = new Map((schema.tags ?? []).map((tag) => [tag.name, []]));
	for (const [path, item] of Object.entries(schema.paths ?? {})) {
		for (const method of METHODS) {
			const operation = item[method];
			if (operation) {
				const tag = operation.tags?.[0];
				byTag.get(tag)?.push(buildOperation(tag, method, path, operation));
			}
		}
	}
	return {
		title: schema.info?.title ?? "",
		version: schema.info?.version ?? "",
		guide: schema.info?.description ?? "",
		groups: (schema.tags ?? [])
			.map((tag) => ({ name: tag.name, intro: tag.description ?? "", operations: byTag.get(tag.name) }))
			.filter((group) => group.operations.length > 0),
	};
};

/**
 * The reference with only the routes that match a query (summary, path, method, operationId or tag)
 *
 * @param {object} reference
 * @param {string} query
 * @returns {object} the same object for an empty query
 */
const filterReference = (reference, query) => {
	const needle = query.trim().toLowerCase();
	if (needle === "") {
		return reference;
	}
	const matches = (op) =>
		[op.summary, op.path, op.method, op.operationId, op.tag].some((value) => value.toLowerCase().includes(needle));
	return {
		...reference,
		groups: reference.groups
			.map((group) => ({ ...group, operations: group.operations.filter(matches) }))
			.filter((group) => group.operations.length > 0),
	};
};

/**
 * The anchor for an old Swagger link "#/<tag>/<operationId>" (the tag is ignored)
 *
 * @param {string} hash
 * @param {object} reference
 * @returns {string | null}
 */
const legacyAnchor = (hash, reference) => {
	const parts = hash.startsWith("#/") ? hash.slice(2).split("/") : [];
	if (parts.length !== 2) {
		return null;
	}
	for (const group of reference.groups) {
		const found = group.operations.find((op) => op.operationId === parts[1]);
		if (found) {
			return found.anchor;
		}
	}
	return null;
};

/**
 * Scrolls to an element and keeps correcting for a few frames: articles above it that render late (content-visibility)
 * change their height and move the target, so one scroll can stop short.
 *
 * @param {{ scrollIntoView: Function }} element
 * @param {{ frame: (cb: () => void) => void, top: () => number, limit?: number, calmFrames?: number, tolerance?: number, stop?: () => boolean }} env
 *   frame schedules the next frame; stop says the reader took over; top is the element's distance from where it should sit
 */
const scrollToSettled = (element, { frame, top, limit = 120, calmFrames = 30, tolerance = 2, stop = () => false }) => {
	let left = limit;
	let calm = 0;
	const step = () => {
		if (stop()) {
			return;
		}
		if (Math.abs(top()) > tolerance) {
			calm = 0;
			element.scrollIntoView({ block: "start" });
		} else {
			calm += 1;
		}
		left -= 1;
		if (left > 0 && calm < calmFrames && !stop()) {
			frame(step);
		}
	};
	step();
};

export {
	anchorOf,
	authOf,
	buildReference,
	exampleOf,
	fieldRows,
	filterReference,
	legacyAnchor,
	scrollToSettled,
	slugOf,
	splitNeeds,
	typeLabel,
};
