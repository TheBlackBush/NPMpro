// Part of the image smoke test (.github/workflows/docker.yml): sends real requests to a running NPMpro, once with the
// classic and once with the JSON log format, reads the lines nginx wrote and fails unless every line matches the field
// lists and the traffic parser. The Log format and Write log files settings are put back as they were found.
// Usage: CHECK_PASSWORD=... node .github/scripts/log-sample-check.js <base URL>
// Environment: CHECK_PASSWORD (admin password), CHECK_CONTAINER (container name, default npmpro), CHECK_HTTP_PORT and
// CHECK_HTTPS_PORT (the proxy ports on the host of the base URL, default 80 and 443), NODE_TLS_REJECT_UNAUTHORIZED=0.
// The instance must already be set up (the CSP check does that). Needs docker, and nc inside the container.
import { execFileSync } from "node:child_process";
import net from "node:net";
import process from "node:process";
import tls from "node:tls";
import { ACCESS_FIELDS, LOG_FORMATS, STREAM_FIELDS, tokenizeClassic } from "../../backend/lib/log-format.js";
import { parseLogLine } from "../../backend/lib/traffic/parse.js";

const [base = "https://127.0.0.1:81"] = process.argv.slice(2);
const password = process.env.CHECK_PASSWORD;
if (!password) throw new Error("CHECK_PASSWORD is not set");
const container = process.env.CHECK_CONTAINER ?? "npmpro";
const proxyHost = new URL(base).hostname;
const httpPort = Number(process.env.CHECK_HTTP_PORT ?? 80);
const httpsPort = Number(process.env.CHECK_HTTPS_PORT ?? 443);
const LOG_DIR = "/data/nginx/logs";
const START_PORT = 20000;
const PORT_SPAN = 30000;

let cookie = "";

async function call(method, path, body) {
	// no kept-alive connection: after a reload it would stay with an old worker, which still writes the old format
	const headers = { cookie, connection: "close" };
	if (body !== undefined) headers["content-type"] = "application/json";
	const answer = await fetch(`${base}/api${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await answer.text();
	return { status: answer.status, text, json: text.startsWith("{") ? JSON.parse(text) : null, answer };
}

async function must(method, path, body) {
	const done = await call(method, path, body);
	if (done.status < 200 || done.status >= 300) throw new Error(`${method} ${path}: ${done.status} ${done.text}`);
	return done.json;
}

async function login() {
	const done = await call("POST", "/tokens", { identity: "admin@example.com", secret: password });
	if (done.status !== 200) throw new Error(`login: ${done.status} ${done.text}`);
	cookie = done.answer.headers
		.getSetCookie()
		.map((line) => line.split(";")[0])
		.join("; ");
	if (!cookie) throw new Error("login: no cookie");
}

const inContainer = (...command) => execFileSync("docker", ["exec", container, ...command], { encoding: "utf8" });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// the number of lines a log file has now, 0 before it exists
const lineCount = (file) => Number(inContainer("sh", "-c", `wc -l < ${file} 2>/dev/null || echo 0`).trim());
const linesAfter = (file, count) =>
	inContainer("tail", "-n", `+${count + 1}`, file)
		.split("\n")
		.filter((line) => line !== "");

// one raw request over a plain or TLS socket, the answer is not read; nginx may close or reset the connection (a
// request it answers with 444, or cannot read) and that is the answer
function rawRequest(port, text, secure) {
	return new Promise((resolve) => {
		const socket = secure
			? tls.connect({ host: proxyHost, port, rejectUnauthorized: false })
			: net.connect({ host: proxyHost, port });
		socket.setTimeout(5000, () => socket.destroy());
		socket.on("error", resolve);
		socket.on("close", resolve);
		socket.on(secure ? "secureConnect" : "connect", () => socket.write(text));
		socket.on("data", () => {});
	});
}

async function sendRequests() {
	await fetch(`${base}/api`, { headers: { connection: "close" } });
	await rawRequest(httpsPort, `GET / HTTP/1.1\r\nHost: ${proxyHost}\r\nConnection: close\r\n\r\n`, true);
	await rawRequest(httpPort, "GARBAGE\r\n\r\n", false);
	await rawRequest(httpPort, "GET / HTTP/1.0\r\n\r\n", false);
}

async function streamRequest(failures) {
	const incomingPort = START_PORT + Math.floor(Math.random() * PORT_SPAN);
	const stream = await must("POST", "/nginx/streams", {
		incoming_port: String(incomingPort),
		forwarding_host: "127.0.0.1",
		forwarding_port: "9",
		tcp_forwarding: true,
		udp_forwarding: false,
	});
	try {
		if (stream.npmpro_nginx_online === false)
			failures.push(`stream on ${incomingPort}: ${stream.npmpro_nginx_err}`);
		inContainer("sh", "-c", `echo hello | nc -w 1 127.0.0.1 ${incomingPort} > /dev/null || true`);
	} finally {
		await must("DELETE", `/nginx/streams/${stream.id}`);
	}
}

// the field values of a line, or null when it does not have the fields of its format
function fieldsOf(format, line, fields) {
	if (format === "classic") return tokenizeClassic(line, fields);
	try {
		const parsed = JSON.parse(line);
		const names = fields.map((item) => item.name);
		return JSON.stringify(Object.keys(parsed)) === JSON.stringify(names) ? parsed : null;
	} catch {
		return null;
	}
}

// A request without a Host header has no host to count, so the traffic parser reads no record from it
const hasRecord = (fields) => fields.host !== "";

function checkLines(format, kind, lines, fields, failures) {
	for (const line of lines) {
		const values = fieldsOf(format, line, fields);
		if (values === null) {
			failures.push(`${format} ${kind} line without its fields: ${line}`);
		} else if (kind === "access" && hasRecord(values) && parseLogLine(line) === null) {
			failures.push(`${format} access line the parser cannot read: ${line}`);
		}
	}
	if (lines.length === 0) failures.push(`${format} ${kind} log: no new line`);
}

// Waits until nginx writes the format: the reload of the setting may finish after the answer, and a request sent
// meanwhile is logged in the old format. A malformed request is the probe.
async function waitForFormat(format) {
	const isJson = (line) => line.startsWith("{");
	for (let attempt = 0; attempt < 30; attempt += 1) {
		const before = lineCount(`${LOG_DIR}/access.log`);
		await rawRequest(httpPort, "GARBAGE\r\n\r\n", false);
		await pause(500);
		const [last] = linesAfter(`${LOG_DIR}/access.log`, before).slice(-1);
		if (last !== undefined && isJson(last) === (format === "json")) return;
	}
	throw new Error(`nginx still writes the other format than ${format} after 15 seconds`);
}

async function checkFormat(format, failures) {
	await must("PUT", "/settings/runtime/logs", { log_format: format });
	await waitForFormat(format);
	const accessBefore = lineCount(`${LOG_DIR}/access.log`);
	const streamBefore = lineCount(`${LOG_DIR}/stream.log`);
	await sendRequests();
	await streamRequest(failures);
	await pause(1000);
	const access = linesAfter(`${LOG_DIR}/access.log`, accessBefore);
	const stream = linesAfter(`${LOG_DIR}/stream.log`, streamBefore);
	checkLines(format, "access", access, ACCESS_FIELDS, failures);
	checkLines(format, "stream", stream, STREAM_FIELDS, failures);
	console.log(`${format}: ${access.length} access lines, ${stream.length} stream lines`);
	// the request to the admin UI and the one by IP to the HTTPS port are the first two lines
	console.log(`${format} access: ${access.find((line) => line.includes("GARBAGE")) ?? access[0]}`);
	console.log(`${format} stream: ${stream[0]}`);
}

await login();
const saved = await must("GET", "/settings/runtime/logs");
const failures = [];
try {
	await must("PUT", "/settings/runtime/logs", { write_log_files: true });
	await pause(1000);
	for (const format of LOG_FORMATS) await checkFormat(format, failures);
} catch (error) {
	failures.push(String(error));
} finally {
	await must("PUT", "/settings/runtime/logs", {
		log_format: saved.log_format,
		write_log_files: saved.write_log_files,
	});
}

if (failures.length > 0) {
	console.error(failures.join("\n"));
	process.exit(1);
}
console.log("the real log lines of both formats match the field lists and the parser");
