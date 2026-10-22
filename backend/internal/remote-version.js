import { remoteVersion as logger } from "../logger.js";
import pjson from "../package.json" with { type: "json" };

// release builds are versioned "<MAJOR.MINOR.PATCH>-<commit>", releases are tagged "v<MAJOR.MINOR.PATCH>"
const releaseBuildPattern = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)-[0-9a-f]+$/u;
const releaseTagPattern = /^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u;

/**
 * @param   {String}  current  version of this build
 * @param   {String}  latest   tag of the latest release
 * @returns {Boolean} true only for release builds older than the latest release
 */
const isUpdateAvailable = (current, latest) => {
	const currentParts = releaseBuildPattern.exec(current)?.slice(1).map(Number);
	const latestParts = releaseTagPattern.exec(latest)?.slice(1).map(Number);
	if (!(currentParts && latestParts)) return false;

	for (let i = 0; i < 3; i++) {
		if (latestParts[i] !== currentParts[i]) return latestParts[i] > currentParts[i];
	}
	return false;
};

const internalRemoteVersion = {
	cache_timeout: 1000 * 60 * 60, // 1 hour
	retry_timeout: 1000 * 60 * 6, // 6 minutes
	last_result: null,
	next_fetch_time: 0,

	/**
	 * Fetch the latest version info, using a cached result if within the cache timeout period.
	 * @return {Promise<{current: string, latest: string, update_available: boolean}>} Version info
	 */
	get: async () => {
		try {
			if (Date.now() >= internalRemoteVersion.next_fetch_time) {
				internalRemoteVersion.next_fetch_time = Date.now() + internalRemoteVersion.retry_timeout;
				const response = await fetch("https://api.github.com/repos/TheBlackBush/NPMpro/releases/latest", {
					headers: {
						"User-Agent": `NPMpro/${pjson.version}`,
					},
					signal: AbortSignal.timeout(10000),
				});

				if (!response.ok) {
					throw new Error(`Status code: ${response.status}`);
				}

				const data = await response.json();

				internalRemoteVersion.last_result = data;
				internalRemoteVersion.next_fetch_time = Date.now() + internalRemoteVersion.cache_timeout;
			}
		} catch (error) {
			logger.error("Failed to fetch remote version:", error.message);
		}

		if (!internalRemoteVersion.last_result) {
			return {
				current: pjson.version,
				latest: "unknown",
				update_available: false,
			};
		}

		const latestVersion = internalRemoteVersion.last_result?.tag_name || "unknown";
		const currentVersion = pjson.version;
		return {
			current: currentVersion,
			latest: latestVersion,
			update_available: isUpdateAvailable(currentVersion, latestVersion),
		};
	},
};

export default internalRemoteVersion;
