import { unquote } from "./nginx-quote.js";

// the path certbot's webroot challenge answers under (lib/certbot-ini.js webroot-path, _common.conf)
const ACME_CHALLENGE_PATH = "/.well-known/acme-challenge/";
// the location types that would be a duplicate of the built-in prefix location: a plain prefix and ^~
const OVERRIDING_TYPES = new Set(["", "^~ "]);

/**
 * Whether a custom location replaces NPMpro's built-in ACME challenge location: enabled, a prefix type ("" or "^~ ")
 * and exactly the challenge path (a path quoted by hand counts, as it renders as the same location)
 *
 * @param   {Object} location  a custom location row (snake_case, as stored)
 * @returns {boolean}
 */
const overridesAcmeChallenge = (location) =>
	location?.npmpro_enabled !== false &&
	OVERRIDING_TYPES.has(location?.location_type ?? "") &&
	unquote(String(location?.path ?? "").trim()) === ACME_CHALLENGE_PATH;

export { ACME_CHALLENGE_PATH, overridesAcmeChallenge };
