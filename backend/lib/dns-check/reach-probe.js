import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { BlockList, isIP } from "node:net";
import { request as undiciRequest } from "undici";
import { isBlockedAddress, isPrivateLanAddress } from "../blocked-address.js";
import { createGuardedAgent } from "../outbound-guard.js";
import { rooted } from "../paths.js";

// The reach probe of the host record option: does a request for the host's name, sent to the public address the
// Dynamic DNS detector confirmed, come back to this server? It writes a one-time token into the ACME webroot (the
// location nginx serves for every host), asks for it on port 80 with the name as Host, and on a redirect to https or
// no answer once more on port 443 with the name as SNI and no certificate check (the token is the proof). Seen from
// inside, so it can say "reachable" but never "unreachable" (D28); a router that answers with its own page is told
// apart. The connection goes only to the confirmed address, never to a typed or resolved one.

const CHALLENGE_DIR = "/data/public/acme-challenge/.well-known/acme-challenge";
const TIMEOUT_MS = 5000;
const MAX_BODY = 4096;

// ranges that are not public although the outbound guard allows them: shared (CGNAT), IETF protocol assignments and
// benchmarking (IPv4), NAT64, 6to4 and the old site-local range (IPv6)
const notPublic = new BlockList();
for (const [network, prefix] of [
	["100.64.0.0", 10],
	["192.0.0.0", 24],
	["198.18.0.0", 15],
]) {
	notPublic.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
	["64:ff9b::", 96],
	["2002::", 16],
	["fec0::", 10],
]) {
	notPublic.addSubnet(network, prefix, "ipv6");
}

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOST_NAME = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`, "iu");
const isPlainHostName = (name) => typeof name === "string" && name.length <= 253 && HOST_NAME.test(name);

// an address a host record may point at and the probe may call: not private, shared (CGNAT), loopback, link-local...
const isPublicAddress = (address) => {
	if (typeof address !== "string" || isIP(address) === 0) return false;
	if (isBlockedAddress(address) || isPrivateLanAddress(address)) return false;
	return !notPublic.check(address, isIP(address) === 4 ? "ipv4" : "ipv6");
};

const writeChallengeToken = async (token) => {
	const dir = rooted(CHALLENGE_DIR);
	await mkdir(dir, { recursive: true });
	await writeFile(`${dir}/${token}`, token, { mode: 0o644 });
};

const removeChallengeToken = (token) => rm(`${rooted(CHALLENGE_DIR)}/${token}`, { force: true });

// reads the body up to MAX_BODY characters and destroys the stream there, so a responder cannot fill the memory
const readBounded = async (body) => {
	let text = "";
	for await (const chunk of body) {
		text += chunk.toString("utf8");
		if (text.length >= MAX_BODY) {
			body.destroy();
			break;
		}
	}
	return text.slice(0, MAX_BODY);
};

/**
 * A request function: one request to the address (never followed on a redirect), through the guarded family-pinned
 * agent. It refuses an address that is not public first (stricter than the agent, which refuses only blocked ones).
 *
 * @param   {Object}    [options]
 * @param   {number}    [options.timeoutMs]   the limit of the whole request
 * @param   {Function}  [options.isAllowed]   (address) => boolean, default isPublicAddress (a test's local server)
 * @param   {Function}  [options.createAgent] (agent options) => dispatcher, default createGuardedAgent (a test's local
 *                                            server)
 * @returns {Function}  ({ scheme, address, family, port, name, path }) => Promise<{ statusCode, headers, body }>,
 *                      rejects when nothing answers
 */
const createRequest =
	({ timeoutMs = TIMEOUT_MS, isAllowed = isPublicAddress, createAgent = createGuardedAgent } = {}) =>
	async ({ scheme, address, family, port, name, path }) => {
		if (!isAllowed(address)) throw new Error("The address is not a public one");
		const agent = createAgent({ family, rejectUnauthorized: false, servername: name });
		try {
			const host = family === 6 ? `[${address}]` : address;
			const response = await undiciRequest(`${scheme}://${host}:${port}${path}`, {
				method: "GET",
				headers: { host: name },
				dispatcher: agent,
				headersTimeout: timeoutMs,
				bodyTimeout: timeoutMs,
				signal: AbortSignal.timeout(timeoutMs),
				maxRedirections: 0,
			});
			const body = await readBounded(response.body);
			return { statusCode: response.statusCode, headers: response.headers, body };
		} finally {
			await agent.close().catch(() => undefined);
		}
	};

const defaultRequest = createRequest();

const headerOf = (headers, key) => {
	const value = headers?.[key];
	return String(Array.isArray(value) ? value[0] : (value ?? ""));
};

// a redirect to https on the host's own name: the https try then follows it by hand
const redirectsToHttps = ({ statusCode, headers }, name) => {
	if (![301, 302, 307, 308].includes(statusCode)) return false;
	try {
		const target = new URL(headerOf(headers, "location"));
		return target.protocol === "https:" && target.hostname.toLowerCase() === name.toLowerCase();
	} catch {
		return false;
	}
};

/**
 * @param   {Object}    options
 * @param   {String}    options.name                the host's name (the Host header and the SNI)
 * @param   {String}    options.address             the confirmed public address of the detector, or null
 * @param   {Function}  [options.writeToken]        (token) => Promise, default: the ACME webroot
 * @param   {Function}  [options.removeToken]       (token) => Promise, default: the ACME webroot
 * @param   {Function}  [options.request]           ({ scheme, address, family, port, name, path }) => { statusCode, headers, body }
 * @param   {boolean}   [options.overridesChallenge]  the host has its own location for the challenge path
 * @returns {Promise<{ result: String, port: number|null, detail: String }>}
 */
const probeReach = async ({
	name,
	address,
	writeToken = writeChallengeToken,
	removeToken = removeChallengeToken,
	request = defaultRequest,
	overridesChallenge = false,
}) => {
	if (!isPlainHostName(name)) throw new TypeError("The reach probe needs a plain host name");
	if (overridesChallenge) {
		return { result: "overridden", port: null, detail: "This host overrides the challenge path" };
	}
	if (!isPublicAddress(address)) {
		return { result: "no-public-address", port: null, detail: "No public address found" };
	}
	const family = isIP(address);
	const token = randomBytes(16).toString("hex");
	const path = `/.well-known/acme-challenge/${token}`;
	const ask = async (scheme, port) => {
		try {
			return await request({ scheme, address, family, port, name, path });
		} catch {
			return null;
		}
	};
	const classify = (answer, port) => {
		if (answer.body.trim() === token)
			return { result: "reachable", port, detail: `Port ${port} reaches this server` };
		return { result: "router-answered", port, detail: `Port ${port} was answered by another server` };
	};
	try {
		await writeToken(token);
		const plain = await ask("http", 80);
		if (plain && !redirectsToHttps(plain, name)) return classify(plain, 80);
		const secure = await ask("https", 443);
		if (secure) return classify(secure, 443);
		return { result: "could-not-confirm", port: null, detail: "No answer from outside this network" };
	} finally {
		await removeToken(token).catch(() => undefined);
	}
};

export { createRequest, isPublicAddress, probeReach };
