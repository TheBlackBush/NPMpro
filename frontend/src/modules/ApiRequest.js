export const TOKEN_VAR = "$NPMPRO_TOKEN";
export const TOKEN_PREFIX = "npmpro_";

const SESSION_NOTE = "Needs a signed-in session: API tokens are refused";
const UPLOAD_NOTE = "File uploads: use the curl command for this route";
const MAX_TEXT = 20_000;
const PATH_PARAM = /\{(?<name>[^}]+)\}/gu;
const JSON_START = /^\s*:/u;
const PUNCT = /^[{}[\],:]$/u;
const DIGIT_START = /^-?\d/u;
// The Node snippet reads the token from the environment through a template string.
const NODE_TOKEN = ["Bearer $", "{process.env.NPMPRO_TOKEN}"].join("");

export const fillPath = (path, values) =>
	path.replace(PATH_PARAM, (_match, name) => {
		const value = values?.[name];
		if (value === undefined || value === null || value === "") {
			throw new Error(`missing-path:${name}`);
		}
		return encodeURIComponent(value);
	});

const pathValues = (operation, values) => {
	const out = { ...values };
	for (const param of operation.params ?? []) {
		if (
			param.in === "path" &&
			(out[param.name] === undefined || out[param.name] === "") &&
			param.example !== undefined
		) {
			out[param.name] = param.example;
		}
	}
	return out;
};

// Fills the path examples; a path parameter without a value stays as {name}.
const exampleUrl = (origin, operation, values) => {
	const known = pathValues(operation, values);
	const path = operation.path.replace(PATH_PARAM, (match, name) => {
		const value = known[name];
		return value === undefined || value === "" ? match : encodeURIComponent(value);
	});
	const query = (operation.params ?? [])
		.filter((param) => param.in === "query" && param.required && param.example !== undefined)
		.map((param) => `${param.name}=${encodeURIComponent(param.example)}`);
	return { url: `${origin}/api${path}`, query: query.join("&") };
};

const fullUrl = (origin, operation, values) => {
	const { url, query } = exampleUrl(origin, operation, values);
	return query ? `${url}?${query}` : url;
};

const isJsonBody = (body) => body?.mediaType === "application/json";

export const buildCurl = ({ origin, operation, values = {} }) => {
	const { url, query } = exampleUrl(origin, operation, values);
	const target = query ? `"${url}?${query}"` : url;
	const first = operation.method === "GET" ? `curl ${target}` : `curl -X ${operation.method} ${target}`;
	const lines = [first];
	if (operation.auth === "token") {
		lines.push(`-H "Authorization: Bearer ${TOKEN_VAR}"`);
	}
	const body = operation.body;
	if (isJsonBody(body)) {
		lines.push('-H "Content-Type: application/json"');
		lines.push(`-d '${JSON.stringify(body.example ?? {}).replaceAll("'", "'\\''")}'`);
	} else if (body?.mediaType === "multipart/form-data") {
		for (const [name, schema] of Object.entries(body.schema?.properties ?? {})) {
			lines.push(schema.format === "binary" ? `-F "${name}=@${name}"` : `-F "${name}=${schema.example ?? name}"`);
		}
	} else if (body?.mediaType === "application/octet-stream") {
		lines.push('-H "Content-Type: application/octet-stream"');
		lines.push("--data-binary @file");
	}
	const command = lines.join(" \\\n  ");
	return operation.auth === "session" ? `# ${SESSION_NOTE}\n${command}` : command;
};

export const buildTryRequest = ({ operation, values, query, bodyText, token }) => {
	const params = new URLSearchParams();
	for (const [name, value] of Object.entries(query ?? {})) {
		if (value !== undefined && value !== null && value !== "") {
			params.append(name, value);
		}
	}
	const search = params.toString();
	const url = `/api${fillPath(operation.path, values)}${search ? `?${search}` : ""}`;
	const headers = { Accept: "application/json" };
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}
	const init = {
		method: operation.method,
		headers,
		credentials: token ? "omit" : "same-origin",
		cache: "no-store",
		redirect: "manual",
	};
	if (bodyText?.trim()) {
		let parsed;
		try {
			parsed = JSON.parse(bodyText);
		} catch (error) {
			throw new Error("invalid-json", { cause: error });
		}
		headers["Content-Type"] = "application/json";
		init.body = JSON.stringify(parsed);
	}
	return { url, init };
};

const JSON_TOKEN = /"(?:[^"\\\n]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}[\],:]/gu;

const pushPlain = (tokens, text) => {
	if (!text) {
		return;
	}
	tokens.push({ kind: "plain", text });
};

const jsonKind = (text, rest) => {
	if (text.startsWith('"')) {
		return JSON_START.test(rest) ? "key" : "string";
	}
	if (PUNCT.test(text)) {
		return "punct";
	}
	return DIGIT_START.test(text) ? "number" : "literal";
};

export const highlightJson = (text) => {
	const tokens = [];
	let at = 0;
	for (const match of text.matchAll(JSON_TOKEN)) {
		pushPlain(tokens, text.slice(at, match.index));
		at = match.index + match[0].length;
		tokens.push({ kind: jsonKind(match[0], text.slice(at)), text: match[0] });
	}
	pushPlain(tokens, text.slice(at));
	return tokens;
};

const SHELL_TOKEN = /(?<=^[ \t]*)#[^\n]*|"(?:[^"\\\n]|\\.)*"|'[^'\n]*'/gmu;

export const highlightShell = (text) => {
	const tokens = [];
	let at = 0;
	for (const match of text.matchAll(SHELL_TOKEN)) {
		pushPlain(tokens, text.slice(at, match.index));
		at = match.index + match[0].length;
		tokens.push({ kind: match[0].startsWith("#") ? "comment" : "string", text: match[0] });
	}
	pushPlain(tokens, text.slice(at));
	return tokens;
};

const cut = (text) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n...` : text);

export const formatAnswer = ({ contentType = "", text = "", size = 0 }) => {
	const type = contentType.split(";")[0].trim().toLowerCase();
	const isJson = type === "application/json" || type.endsWith("+json");
	if (isJson) {
		try {
			return { kind: "json", text: cut(JSON.stringify(JSON.parse(text), null, 2)) };
		} catch {
			return { kind: "text", text: cut(text) };
		}
	}
	if (type.startsWith("text/")) {
		return { kind: "text", text: cut(text) };
	}
	return { kind: "binary", text: `${contentType}, ${size} bytes` };
};

const indentAfterFirst = (text, pad) => text.replaceAll("\n", `\n${pad}`);

export const buildNode = ({ origin, operation, values = {} }) => {
	const body = operation.body;
	if (body && !isJsonBody(body)) {
		return `// ${UPLOAD_NOTE}`;
	}
	const token = operation.auth === "token";
	const lines = [];
	if (operation.auth === "session") {
		lines.push(`// ${SESSION_NOTE}`);
	}
	lines.push(`const response = await fetch("${fullUrl(origin, operation, values)}", {`);
	if (operation.method !== "GET") {
		lines.push(`  method: "${operation.method}",`);
	}
	if (body) {
		lines.push("  headers: {");
		if (token) {
			lines.push(`    Authorization: \`${NODE_TOKEN}\`,`);
		}
		lines.push('    "Content-Type": "application/json",', "  },");
		lines.push(`  body: JSON.stringify(${indentAfterFirst(JSON.stringify(body.example ?? {}, null, 2), "  ")}),`);
	} else if (token) {
		lines.push(`  headers: { Authorization: \`${NODE_TOKEN}\` },`);
	}
	lines.push("});", "console.log(response.status, await response.text());");
	return lines.join("\n");
};

const PYTHON_LITERAL = { true: "True", false: "False", null: "None" };

const pythonLiteral = (value) =>
	highlightJson(JSON.stringify(value ?? {}, null, 4))
		.map((token) => (token.kind === "literal" ? PYTHON_LITERAL[token.text] : token.text))
		.join("");

export const buildPython = ({ origin, operation, values = {} }) => {
	const body = operation.body;
	if (body && !isJsonBody(body)) {
		return `# ${UPLOAD_NOTE}`;
	}
	const token = operation.auth === "token";
	const lines = [];
	if (operation.auth === "session") {
		lines.push(`# ${SESSION_NOTE}`);
	}
	if (token) {
		lines.push("import os");
	}
	lines.push("import requests", "", `response = requests.${operation.method.toLowerCase()}(`);
	lines.push(`    "${fullUrl(origin, operation, values)}",`);
	if (token) {
		lines.push(`    headers={"Authorization": f"Bearer {os.environ['NPMPRO_TOKEN']}"},`);
	}
	if (body) {
		lines.push(`    json=${indentAfterFirst(pythonLiteral(body.example), "    ")},`);
	}
	lines.push(")", "print(response.status_code, response.text)");
	return lines.join("\n");
};
