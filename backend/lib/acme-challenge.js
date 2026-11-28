import { unquote } from "./nginx-quote.js";

// the path certbot's webroot challenge answers under (lib/certbot-ini.js webroot-path, _common.conf)
const ACME_CHALLENGE_PATH = "/.well-known/acme-challenge/";
// the location types that would be a duplicate of the built-in prefix location: a plain prefix and ^~
const OVERRIDING_TYPES = new Set(["", "^~ "]);
// the location types whose path is a literal prefix or exact path (no regular expression, no named location)
const LITERAL_TYPES = new Set(["", "^~ ", "= "]);

/**
 * Whether a custom location replaces NPMpro's built-in ACME challenge location: enabled, a prefix type ("" or "^~ ")
 * and exactly the challenge path (a path quoted by hand counts, as it renders as the same location; a padded one does
 * not, as it renders padded and never matches)
 *
 * @param   {Object} location  a custom location row (snake_case, as stored)
 * @returns {boolean}
 */
const overridesAcmeChallenge = (location) =>
	location?.npmpro_enabled !== false &&
	OVERRIDING_TYPES.has(location?.location_type ?? "") &&
	unquote(String(location?.path ?? "")) === ACME_CHALLENGE_PATH;

/**
 * Whether a custom location only matches requests under the ACME challenge path, so it keeps no country gate: a prefix
 * or exact type (a regular expression could match other paths too) and a path that starts with the challenge path
 *
 * @param   {Object} location  a custom location row (snake_case, as stored)
 * @returns {boolean}
 */
const servesAcmeChallengeOnly = (location) =>
	LITERAL_TYPES.has(location?.location_type ?? "") &&
	unquote(String(location?.path ?? "")).startsWith(ACME_CHALLENGE_PATH);

export { ACME_CHALLENGE_PATH, overridesAcmeChallenge, servesAcmeChallengeOnly };
