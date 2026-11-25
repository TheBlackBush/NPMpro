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

const cgnat = new BlockList();
cgnat.addSubnet("100.64.0.0", 10, "ipv4");

// an address a host record may point at and the probe may call: not private, shared (CGNAT), loopback, link-local...
const isPublicAddress = (address) => {
	if (typeof address !== "string" || isIP(address) === 0) return false;
	if (isBlockedAddress(address) || isPrivateLanAddress(address)) return false;
	return !(isIP(address) === 4 && cgnat.check(address, "ipv4"));
};

const writeChallengeToken = async (token) => {
	const dir = rooted(CHALLENGE_DIR);
	await mkdir(dir, { recursive: true });
	await writeFile(`${dir}/${token}`, token, { mode: 0o644 });
};

const removeChallengeToken = (token) => rm(`${rooted(CHALLENGE_DIR)}/${token}`, { force: true });

/**
 * One request to the address (never followed on a redirect), through the guarded family-pinned agent
 *
 * @param   {Object}  options  { scheme, address, family, port, name, path }
 * @returns {Promise<{ statusCode: number, headers: Object, body: string }>}  rejects when nothing answers
 */
const defaultRequest = async ({ scheme, address, family, port, name, path }) => {
	const agent = createGuardedAgent({ family, rejectUnauthorized: false, servername: name });
	try {
		const host = family === 6 ? `[${address}]` : address;
		const response = await undiciRequest(`${scheme}://${host}:${port}${path}`, {
			method: "GET",
			headers: { host: name },
			dispatcher: agent,
			headersTimeout: TIMEOUT_MS,
			bodyTimeout: TIMEOUT_MS,
			signal: AbortSignal.timeout(TIMEOUT_MS),
			maxRedirections: 0,
		});
		const text = await response.body.text();
		return { statusCode: response.statusCode, headers: response.headers, body: text.slice(0, MAX_BODY) };
	} finally {
		await agent.close().catch(() => undefined);
	}
};

const headerOf = (headers, key) => {
	const value = headers?.[key];
	return String(Array.isArray(value) ? value[0] : (value ?? ""));
};

/**
 * @param   {Object}    options
 * @param   {String}    options.name                the host's name (the Host header and the SNI)
 * @param   {String}    options.address             the confirmed public address of the detector, or null
 * @param   {number}    options.family              4 or 6
 * @param   {Function}  [options.writeToken]        (token) => Promise, default: the ACME webroot
 * @param   {Function}  [options.removeToken]       (token) => Promise, default: the ACME webroot
 * @param   {Function}  [options.request]           ({ scheme, address, family, port, name, path }) => { statusCode, headers, body }
 * @param   {boolean}   [options.overridesChallenge]  the host has its own location for the challenge path
 * @returns {Promise<{ result: String, port: number|null, detail: String }>}
 */
const probeReach = async ({
	name,
	address,
	family,
	writeToken = writeChallengeToken,
	removeToken = removeChallengeToken,
	request = defaultRequest,
	overridesChallenge = false,
}) => {
	if (overridesChallenge) {
		return { result: "overridden", port: null, detail: "This host overrides the challenge path" };
	}
	if (!isPublicAddress(address)) {
		return { result: "no-public-address", port: null, detail: "No public address found" };
	}
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
		if (plain) {
			const redirect =
				[301, 308].includes(plain.statusCode) && headerOf(plain.headers, "location").startsWith("https://");
			if (!redirect) return classify(plain, 80);
		}
		const secure = await ask("https", 443);
		if (secure) return classify(secure, 443);
		return { result: "could-not-confirm", port: null, detail: "No answer from outside this network" };
	} finally {
		await removeToken(token).catch(() => undefined);
	}
};

export { defaultRequest, isPublicAddress, probeReach };
