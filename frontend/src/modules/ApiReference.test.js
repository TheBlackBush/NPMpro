import assert from "node:assert/strict";
import { it } from "node:test";
import {
	anchorOf,
	authOf,
	buildReference,
	exampleOf,
	fieldRows,
	filterReference,
	legacyAnchor,
	slugOf,
	splitNeeds,
	typeLabel,
} from "./ApiReference.js";

const HOST = {
	type: "object",
	required: ["domain_names", "forward_port"],
	properties: {
		domain_names: { type: "array", items: { type: "string" }, description: "Domains" },
		forward_port: { type: "integer", description: "Port" },
		forward_scheme: { type: "string", enum: ["http", "https"] },
		certificate_id: { oneOf: [{ type: "integer" }, { type: "string", enum: ["new"] }] },
		meta: { type: "object", properties: { dns_challenge: { type: "boolean", description: "DNS" } } },
		locations: {
			type: "array",
			items: { type: "object", required: ["path"], properties: { path: { type: "string" } } },
		},
	},
};

const SCHEMA = {
	info: { title: "NPMpro API", version: "1.0.0", description: "Intro" },
	tags: [
		{ name: "proxy-hosts", description: "Proxy hosts intro" },
		{ name: "empty", description: "No routes" },
		{ name: "public", description: "Public intro" },
	],
	paths: {
		"/nginx/proxy-hosts": {
			post: {
				operationId: "createProxyHost",
				summary: "Create a proxy host",
				tags: ["proxy-hosts"],
				security: [{ cookieAuth: [] }, { bearerAuth: [] }],
				description: "Creates one.\n\nNeeds: Proxy Hosts manage",
				requestBody: {
					content: {
						"application/json": { schema: HOST, examples: { default: { value: { forward_port: 80 } } } },
					},
				},
				responses: {
					400: { description: "Refused" },
					201: { description: "The created host", content: { "application/json": { example: { id: 12 } } } },
				},
			},
			get: {
				operationId: "getProxyHosts",
				summary: "List proxy hosts",
				tags: ["proxy-hosts"],
				security: [{ cookieAuth: [] }, { bearerAuth: [] }],
				description: "Lists them.\n\nNeeds: Proxy Hosts view",
				parameters: [
					{ in: "query", name: "expand", schema: { type: "string" }, description: "Relations" },
					{ in: "header", name: "X-Ignored", schema: { type: "string" } },
				],
				responses: { 200: { description: "The hosts" } },
			},
		},
		"/": {
			get: {
				operationId: "health",
				summary: "Check the health",
				tags: ["public"],
				description: "Health.\n\nNeeds: nothing (public)",
				responses: { 200: { description: "OK" } },
			},
		},
		"/backups/upload": {
			post: {
				operationId: "uploadBackup",
				summary: "Upload a backup",
				tags: ["public"],
				security: [{ cookieAuth: [] }],
				description: "Upload.",
				requestBody: {
					content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
				},
				responses: { 201: { description: "Stored" } },
			},
		},
	},
};

it("splitNeeds takes the last Needs line off the description", () => {
	assert.deepEqual(splitNeeds("Creates one.\n\nNeeds: Proxy Hosts manage"), {
		text: "Creates one.",
		needs: "Proxy Hosts manage",
	});
	assert.deepEqual(splitNeeds("No line here."), { text: "No line here.", needs: null });
	assert.deepEqual(splitNeeds(undefined), { text: "", needs: null });
	assert.deepEqual(splitNeeds("Needs: in the middle\nmore"), { text: "Needs: in the middle\nmore", needs: null });
});

it("slugOf and anchorOf make stable anchors", () => {
	assert.equal(slugOf("/nginx/proxy-hosts/{hostID}/enable"), "nginx-proxy-hosts-hostid-enable");
	assert.equal(slugOf("/"), "root");
	assert.equal(anchorOf("proxy-hosts", "post", "/nginx/proxy-hosts"), "proxy-hosts/post-nginx-proxy-hosts");
	assert.equal(anchorOf("public", "get", "/"), "public/get-root");
});

it("typeLabel names the type the way the reference shows it", () => {
	assert.equal(typeLabel({ type: "string", enum: ["http", "https"] }), '"http" | "https"');
	assert.equal(typeLabel({ type: "integer", enum: [1, 2] }), "1 | 2");
	assert.equal(typeLabel({ oneOf: [{ type: "integer" }, { type: "string", enum: ["new"] }] }), 'integer | "new"');
	assert.equal(typeLabel({ type: ["null", "string"] }), "string | null");
	assert.equal(typeLabel({ type: "array", items: { type: "string" } }), "array of string");
	assert.equal(typeLabel({ properties: { a: {} } }), "object");
	assert.equal(typeLabel({}), "any");
	assert.equal(typeLabel(undefined), "any");
});

it("fieldRows flattens nested fields with their required flags", () => {
	assert.deepEqual(
		fieldRows(HOST).map(({ name, type, required, depth }) => [name, type, required, depth]),
		[
			["domain_names", "array of string", true, 1],
			["forward_port", "integer", true, 1],
			["forward_scheme", '"http" | "https"', false, 1],
			["certificate_id", 'integer | "new"', false, 1],
			["meta", "object", false, 1],
			["meta.dns_challenge", "boolean", false, 2],
			["locations", "array of object", false, 1],
			["locations[].path", "string", true, 2],
		],
	);
	assert.equal(fieldRows(HOST, 1).length, 6);
	assert.deepEqual(fieldRows(undefined), []);
	assert.deepEqual(
		fieldRows({
			oneOf: [{ properties: { a: { type: "string" } } }, { properties: { a: { type: "integer" }, b: {} } }],
		}).map((row) => [row.name, row.type]),
		[
			["a", "string"],
			["b", "any"],
		],
	);
});

it("exampleOf reads the default example, another named one or the plain example", () => {
	assert.deepEqual(exampleOf({ examples: { default: { value: 1 }, other: { value: 2 } } }), 1);
	assert.deepEqual(exampleOf({ examples: { custom: { value: 3 } } }), 3);
	assert.deepEqual(exampleOf({ example: 4 }), 4);
	assert.equal(exampleOf({}), undefined);
	assert.equal(exampleOf(undefined), undefined);
});

it("authOf tells public, session-only and token routes apart", () => {
	assert.equal(authOf({}), "public");
	assert.equal(authOf({ security: [] }), "public");
	assert.equal(authOf({ security: [{ cookieAuth: [] }] }), "session");
	assert.equal(authOf({ security: [{ cookieAuth: [] }, { bearerAuth: [] }] }), "token");
});

it("buildReference groups the routes in the tag order and drops empty groups", () => {
	const ref = buildReference(SCHEMA);
	assert.equal(ref.title, "NPMpro API");
	assert.equal(ref.version, "1.0.0");
	assert.equal(ref.guide, "Intro");
	assert.deepEqual(
		ref.groups.map((group) => [group.name, group.operations.map((op) => op.anchor)]),
		[
			["proxy-hosts", ["proxy-hosts/get-nginx-proxy-hosts", "proxy-hosts/post-nginx-proxy-hosts"]],
			["public", ["public/get-root", "public/post-backups-upload"]],
		],
	);
	const [list, create] = ref.groups[0].operations;
	assert.equal(list.method, "GET");
	assert.equal(list.needs, "Proxy Hosts view");
	assert.equal(list.text, "Lists them.");
	assert.deepEqual(
		list.params.map((p) => [p.name, p.in, p.required, p.type]),
		[["expand", "query", false, "string"]],
	);
	assert.equal(list.body, null);
	assert.equal(create.body.mediaType, "application/json");
	assert.equal(create.body.schema, HOST);
	assert.equal(create.body.fields.length, 8);
	assert.equal(create.body.tryable, true);
	assert.deepEqual(create.body.example, { forward_port: 80 });
	assert.deepEqual(
		create.responses.map((r) => [r.status, r.mediaType, r.example]),
		[
			["201", "application/json", { id: 12 }],
			["400", null, undefined],
		],
	);
	const upload = ref.groups[1].operations[1];
	assert.equal(upload.auth, "session");
	assert.equal(upload.body.tryable, false);
	assert.equal(upload.needs, null);
});

it("filterReference keeps the matching routes and their groups", () => {
	const ref = buildReference(SCHEMA);
	assert.equal(filterReference(ref, "  "), ref);
	assert.deepEqual(
		filterReference(ref, "PROXY").groups.map((g) => g.operations.length),
		[2],
	);
	assert.deepEqual(filterReference(ref, "delete").groups, []);
	assert.equal(filterReference(ref, "health").groups[0].operations[0].anchor, "public/get-root");
	assert.equal(filterReference(ref, "/backups").groups[0].operations[0].operationId, "uploadBackup");
});

it("legacyAnchor turns an old Swagger link into the new anchor", () => {
	const ref = buildReference(SCHEMA);
	assert.equal(legacyAnchor("#/proxy-hosts/getProxyHosts", ref), "proxy-hosts/get-nginx-proxy-hosts");
	assert.equal(legacyAnchor("#/Proxy%20Hosts/createProxyHost", ref), "proxy-hosts/post-nginx-proxy-hosts");
	assert.equal(legacyAnchor("#/proxy-hosts/nope", ref), null);
	assert.equal(legacyAnchor("#proxy-hosts/get-nginx-proxy-hosts", ref), null);
	assert.equal(legacyAnchor("", ref), null);
});

it("buildReference copes with a bare schema and sparse operations", () => {
	assert.deepEqual(buildReference({}), { title: "", version: "", guide: "", groups: [] });
	const ref = buildReference({
		tags: [{ name: "t" }],
		paths: {
			"/x/{id}": {
				put: {
					operationId: "putX",
					tags: ["t"],
					parameters: [
						{ in: "path", name: "id", required: true, schema: { type: "integer", example: 7 } },
						{ in: "query", name: "q", example: "a" },
					],
					requestBody: { content: {} },
					responses: { 200: {} },
				},
				post: { operationId: "orphan", tags: ["other"], responses: {} },
			},
			"/y": {},
		},
	});
	const [op] = ref.groups[0].operations;
	assert.equal(ref.groups[0].intro, "");
	assert.equal(op.summary, "");
	assert.deepEqual(
		op.params.map((p) => [p.name, p.required, p.type, p.description, p.example]),
		[
			["id", true, "integer", "", 7],
			["q", false, "any", "", "a"],
		],
	);
	assert.equal(op.body.mediaType, null);
	assert.equal(op.body.tryable, true);
	assert.deepEqual(op.responses, [{ status: "200", description: "", mediaType: null, example: undefined }]);
	assert.equal(
		buildReference({ tags: [{ name: "t" }], paths: { "/a": { get: { operationId: "a", tags: ["t"] } } } }).groups[0]
			.operations[0].responses.length,
		0,
	);
});

it("fieldRows stops at the depth limit and reads anyOf", () => {
	const deep = { properties: { a: { properties: { b: { properties: { c: { properties: { d: {} } } } } } } } };
	assert.deepEqual(
		fieldRows(deep).map((row) => row.name),
		["a", "a.b", "a.b.c"],
	);
	assert.deepEqual(fieldRows({ anyOf: [{ properties: { z: { description: "Z" } } }] })[0].description, "Z");
	assert.equal(typeLabel({ anyOf: [{ type: "string" }, { type: "null" }] }), "string | null");
	assert.equal(typeLabel({ type: ["string", "integer"] }), "string | integer");
});
