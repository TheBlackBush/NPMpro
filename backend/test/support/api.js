import { argon2 } from "node:crypto";
import dns from "node:dns";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { MockAgent, setGlobalDispatcher } from "undici";

// The real backend on a free local port, with its own temporary root, SQLite database and migrations. Only the outside
// is fake: nginx, certbot and pip (scripts on PATH that record their arguments), the nginx control socket, DNS and
// outbound HTTP. One startApi per test file: the modules keep their database and paths for the whole process.

const LOCAL_ADDRESS = /^127\.0\.0\.1:/u;
const PASSWORD = "correct-horse-battery-9";
const FAKE_COMMANDS = ["nginx", "certbot", "pip"];
const DIRS = [
	"bin",
	"fake",
	"data/access",
	"data/backups",
	"data/crowdsec",
	"data/goaccess/geoip",
	"data/nginx/dead_host",
	"data/nginx/logs",
	"data/nginx/proxy_host",
	"data/nginx/redirection_host",
	"data/nginx/stream",
	"data/npmpro/nginx",
	"data/public/acme-challenge/.well-known/acme-challenge",
	"data/public/avatar",
	"data/public/gravatar",
	"data/public/html",
	"data/tls/certbot/live",
	"data/tls/certbot/renewal",
	"data/tls/custom",
	"data/tls/mtls",
	"run/npmpro",
	"usr/local/nginx/conf/conf.d",
];

const fakeCommand = (root, name) => `#!/bin/sh
printf '%s\\n' "${name} $*" >> "${root}/fake/calls.log"
if [ -x "${root}/fake/${name}.hook" ]; then exec "${root}/fake/${name}.hook" "$@"; fi
if [ -f "${root}/fake/${name}.fail" ]; then cat "${root}/fake/${name}.fail" >&2; exit 1; fi
`;

const startControlSocket = async (socket) => {
	const control = { reloads: 0, failNext: null };
	const server = http.createServer((_, res) => {
		control.reloads += 1;
		const failure = control.failNext;
		control.failNext = null;
		res.statusCode = failure === null ? 200 : 500;
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ logs: failure === null ? [] : [failure] }));
	});
	await new Promise((resolve) => server.listen(socket, resolve));
	return { control, close: () => new Promise((resolve) => server.close(resolve)) };
};

// A name resolves only when a test added it, so a request by name through a dispatcher of its own finds no DNS. IP
// literals skip the lookup, and code on node:https is not seen by the MockAgent: later tests point such features at a
// local fake.
const fakeDns = () => {
	const names = new Map();
	dns.lookup = (hostname, options, callback) => {
		const done = typeof options === "function" ? options : callback;
		const address = isIP(hostname) ? hostname : names.get(hostname);
		if (!address) {
			done(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND", hostname }));
			return;
		}
		const family = address.includes(":") ? 6 : 4;
		if (options?.all) done(null, [{ address, family }]);
		else done(null, address, family);
	};
	syncBuiltinESMExports();
	return names;
};

const fakeHttp = () => {
	const agent = new MockAgent();
	agent.disableNetConnect();
	agent.enableNetConnect(LOCAL_ADDRESS);
	setGlobalDispatcher(agent);
	return agent;
};

const createClient = (base, ip) => {
	const jar = new Map();
	const send = async (method, url, { body, form, headers = {} } = {}) => {
		const res = await fetch(`${base}/api${url}`, {
			method,
			headers: {
				"x-forwarded-for": ip,
				...(body === undefined ? {} : { "content-type": "application/json" }),
				...(jar.size === 0 ? {} : { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") }),
				...headers,
			},
			body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
		});
		for (const line of res.headers.getSetCookie()) {
			const [pair] = line.split(";");
			const split = pair.indexOf("=");
			const value = pair.slice(split + 1);
			if (value === "") jar.delete(pair.slice(0, split));
			else jar.set(pair.slice(0, split), value);
		}
		const bytes = Buffer.from(await res.arrayBuffer());
		const text = bytes.toString("utf8");
		const isJson = res.headers.get("content-type")?.includes("json");
		return { status: res.status, headers: res.headers, bytes, text, body: isJson ? JSON.parse(text) : text };
	};
	return {
		jar,
		get: (url, options) => send("GET", url, options),
		post: (url, body, options) => send("POST", url, { ...options, body }),
		put: (url, body, options) => send("PUT", url, { ...options, body }),
		delete: (url, options) => send("DELETE", url, options),
		send,
	};
};

const assertOk = (response, what) => {
	if (response.status >= 300) throw new Error(`${what} answered ${response.status}: ${response.text}`);
	return response.body;
};

/**
 * @param   {Object}  [options]
 * @param   {Object}  [options.env]  environment of the backend, set before its modules load
 * @returns {Promise<Object>}        { root, client, admin, limited, read, db, outside, stop }
 */
const startApi = async ({ env = {} } = {}) => {
	if (!argon2) throw new Error("the API tests need a Node.js with crypto.argon2 (24.7 or newer)");
	const root = await mkdtemp(path.join(os.tmpdir(), "npa-"));
	// the backend logs through console.log; API_TEST_LOG=1 shows it while debugging a test
	if (!process.env.API_TEST_LOG) console.log = () => {};
	let controlSocket;
	let server;
	try {
		for (const dir of DIRS) await mkdir(path.join(root, dir), { recursive: true });
		for (const name of FAKE_COMMANDS) {
			await writeFile(path.join(root, "bin", name), fakeCommand(root, name), { mode: 0o755 });
		}
		// a developer shell must not point the backend away from the temporary root
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("DB_") || key === "NPMPRO_SECRET_KEY_FILE") delete process.env[key];
		}
		Object.assign(process.env, {
			NPMPRO_TEST_ROOT: root,
			PATH: `${path.join(root, "bin")}:${process.env.PATH}`,
			COOKIE_SECRET: "api-test-cookie-secret",
			DISABLE_GRAVATAR: "true",
			DISABLE_NGINX_BEAUTIFIER: "true",
			...env,
		});
		controlSocket = await startControlSocket(path.join(root, "run/nginx-control.sock"));
		const outside = {
			control: controlSocket.control,
			dns: fakeDns(),
			http: fakeHttp(),
			calls: async () =>
				(await readFile(path.join(root, "fake/calls.log"), "utf8").catch(() => ""))
					.trim()
					.split("\n")
					.filter(Boolean),
			clearCalls: () => rm(path.join(root, "fake/calls.log"), { force: true }),
			failCommand: (name, output) => writeFile(path.join(root, "fake", `${name}.fail`), output),
			passCommand: (name) => rm(path.join(root, "fake", `${name}.fail`), { force: true }),
			hookCommand: async (name, script) => {
				await writeFile(path.join(root, "fake", `${name}.hook`), script);
				await chmod(path.join(root, "fake", `${name}.hook`), 0o755);
			},
		};

		const { rooted } = await import("../../lib/paths.js");
		if (rooted("/") !== `${root}/`)
			throw new Error("startApi must run before any backend import, once per test file");
		const { migrateUp } = await import("../../migrate.js");
		await migrateUp();
		const { prepareApp } = await import("../../startup.js");
		await prepareApp({ background: false });
		const { default: app } = await import("../../app.js");
		const { default: db } = await import("../../db.js");
		server = await new Promise((resolve, reject) => {
			const listening = app.listen(0, "127.0.0.1", (err) => (err ? reject(err) : resolve(listening)));
		});
		const base = `http://127.0.0.1:${server.address().port}`;

		// every client has its own address, so the rate limits of one test do not reach another
		let clients = 0;
		const client = () => {
			clients += 1;
			return createClient(base, `198.51.100.${clients}`);
		};
		const login = async (email) => {
			const session = client();
			assertOk(await session.post("/tokens", { identity: email, secret: PASSWORD }), `login of ${email}`);
			return session;
		};

		let adminSession = null;
		const admin = async () => {
			if (adminSession) return adminSession;
			const email = "admin@example.com";
			assertOk(
				await client().post("/users/setup", {
					name: "Admin",
					email,
					auth: { type: "password", secret: PASSWORD },
				}),
				"setup",
			);
			adminSession = await login(email);
			return adminSession;
		};

		let limitedUsers = 0;
		const limited = async (permissions) => {
			const session = await admin();
			limitedUsers += 1;
			const email = `user${limitedUsers}@example.com`;
			const user = assertOk(
				await session.post("/users", {
					name: `User ${limitedUsers}`,
					email,
					roles: [],
					auth: { type: "password", secret: PASSWORD },
				}),
				"create user",
			);
			assertOk(await session.put(`/users/${user.id}/permissions`, permissions), "set permissions");
			const own = await login(email);
			own.user = user;
			return own;
		};

		return {
			root,
			client,
			admin,
			limited,
			outside,
			db: db(),
			// the text with container paths, as a real install has it
			read: async (file) => (await readFile(path.join(root, file), "utf8")).replaceAll(root, ""),
			stop: async () => {
				server.closeAllConnections();
				await new Promise((resolve) => server.close(resolve));
				await controlSocket.close();
				await db().destroy();
				await rm(root, { recursive: true, force: true });
			},
		};
	} catch (error) {
		server?.closeAllConnections();
		server?.close();
		await controlSocket?.close();
		const { default: db } = await import("../../db.js");
		await db().destroy();
		await rm(root, { recursive: true, force: true });
		throw error;
	}
};

export { PASSWORD, startApi };
