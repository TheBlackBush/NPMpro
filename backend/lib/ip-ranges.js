import nodeFs from "node:fs/promises";
import { ipRanges as logger } from "../logger.js";
import pjson from "../package.json" with { type: "json" };
import { PATHS, testAndReload, withFiles } from "./runtime-apply.js";
import { effectiveEnv as defaultEffectiveEnv } from "./runtime-config.js";
import utils from "./utils.js";

const CLOUDFLARE_V4_URL = "https://www.cloudflare.com/ips-v4";
const CLOUDFLARE_V6_URL = "https://www.cloudflare.com/ips-v6";
const FETCH_TIMEOUT = 30_000;
const REFRESH_INTERVAL = 1000 * 60 * 60;
const TEMPLATE = `${import.meta.dirname}/../templates/ip_ranges.conf`;

const regIpV4 = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}\/[0-9]{1,2}$/u;
const regIpV6 = /^[0-9a-fA-F:]+\/[0-9]{1,3}$/u;

const linesMatching = (text, reg) =>
	text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => reg.test(line));

/**
 * The Cloudflare ranges from the ips-v4 and ips-v6 lists
 *
 * @param   {string}  v4
 * @param   {string}  v6
 * @returns {string[]}
 */
const parseCloudflareRanges = (v4, v6) => [...linesMatching(v4, regIpV4), ...linesMatching(v6, regIpV6)];

const fetchUrl = async (url) => {
	const res = await fetch(url, {
		headers: { "User-Agent": `NPMpro/${pjson.version}` },
		signal: AbortSignal.timeout(FETCH_TIMEOUT),
	});
	if (!res.ok) throw new Error(`Status code: ${res.status}`);
	return res.text();
};

/**
 * ip_ranges.conf: set_real_ip_from for the trusted IPs (env.TRUST_IP of the env given) and the Cloudflare ranges
 *
 * @param   {Object}    env
 * @param   {string[]}  ranges  the Cloudflare ranges, [] when Cloudflare is not trusted
 * @returns {Promise<string>}
 */
const renderIpRanges = async (env, ranges, { fs = nodeFs } = {}) =>
	utils.getRenderEngine().parseAndRender(await fs.readFile(TEMPLATE, "utf8"), { ip_ranges: ranges, env });

/**
 * The trusted IP ranges (network runtime settings): Cloudflare range cache, the hourly refresh timer and the render
 * of ip_ranges.conf
 *
 * @param   {Object}    deps
 * @param   {Object}    deps.nginx           { test, reload }
 * @param   {Function}  [deps.exclusive]     (fn) => runs fn in the runtime settings queue (no write during a save)
 * @param   {Function}  [deps.fetchText]     (url) => body text
 * @param   {Function}  [deps.effectiveEnv]
 * @param   {Object}    [deps.fs]
 * @param   {Object}    [deps.log]
 * @param   {string}    [deps.path]          ip_ranges.conf
 * @param   {Object}    [deps.clock]         { setInterval, clearInterval }
 * @param   {number}    [deps.interval]      ms between refreshes
 */
const createIpRanges = ({
	nginx,
	exclusive = (fn) => fn(),
	fetchText = fetchUrl,
	effectiveEnv = defaultEffectiveEnv,
	fs = nodeFs,
	log = logger,
	path = PATHS.ipRangesConf,
	clock = globalThis,
	interval = REFRESH_INTERVAL,
} = {}) => {
	let cached = [];
	let timer = null;
	let processing = false;

	/**
	 * Fetches the Cloudflare ranges and keeps them for later renders; throws when the lists cannot be read or are empty
	 *
	 * @returns {Promise<string[]>}
	 */
	const fetchCloudflare = async () => {
		log.info("Fetching IP Ranges from online services...");
		const [v4, v6] = await Promise.all([fetchText(CLOUDFLARE_V4_URL), fetchText(CLOUDFLARE_V6_URL)]);
		const ranges = parseCloudflareRanges(v4, v6);
		if (ranges.length === 0) throw new Error("The Cloudflare IP lists hold no ranges");
		cached = ranges;
		return [...ranges];
	};

	const render = (env, ranges) => renderIpRanges(env, ranges, { fs });

	/**
	 * Timer tick: fetches the Cloudflare ranges and, in the runtime settings queue, writes ip_ranges.conf with the
	 * saved trusted IPs, nginx -t and reload when it changed (restored on failure). Skipped when Cloudflare was turned
	 * off meanwhile.
	 */
	const refresh = async () => {
		if (processing) return;
		processing = true;
		try {
			const ranges = await fetchCloudflare();
			await exclusive(async () => {
				const env = effectiveEnv();
				if (timer === null || env.TRUST_CLOUDFLARE !== "true") return;
				const content = await render(env, ranges);
				const written = await withFiles(
					[{ path, content }],
					async (paths) => {
						if (paths.length > 0) await testAndReload(nginx);
						return paths.length > 0;
					},
					{ fs, log },
				);
				if (written) log.info("Updated trusted IP ranges");
				else log.debug("Trusted IP ranges unchanged");
			});
		} catch (err) {
			log.error(`Could not update the Cloudflare IP ranges: ${err.message}`);
		} finally {
			processing = false;
		}
	};

	const start = () => {
		if (timer !== null) return;
		log.info("Cloudflares IPs are trusted, IP Ranges Renewal Timer initialized");
		timer = clock.setInterval(refresh, interval);
	};

	const stop = () => {
		if (timer !== null) clock.clearInterval(timer);
		timer = null;
		log.info("Cloudflares IPs are NOT trusted");
	};

	return {
		fetchCloudflare,
		ranges: () => [...cached],
		refresh,
		render,
		running: () => timer !== null,
		start,
		stop,
	};
};

export { createIpRanges, parseCloudflareRanges, renderIpRanges };
