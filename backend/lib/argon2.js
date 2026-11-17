import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(argon2);

const STRONG = Object.freeze({ memory: 65536, passes: 3, parallelism: 4 });
const MINIMAL = Object.freeze({ memory: 19456, passes: 2, parallelism: 1 });
const TEST = Object.freeze({ memory: 64, passes: 1, parallelism: 1 });

/**
 * The cost of a new hash: the second recommended option of RFC 9106, or with minimal the OWASP minimum (for secrets
 * that are randomly generated instead of chosen by a user). The backend tests (test/support/api.js) set
 * NPMPRO_TEST_ARGON2=fast for a cheap cost; it counts only together with the tests' temporary root NPMPRO_TEST_ROOT,
 * which the image never sets.
 *
 * @param   {Boolean} minimal
 * @param   {Object}  [env]
 * @returns {{ memory: number, passes: number, parallelism: number }}
 */
const hashParams = (minimal, env = process.env) => {
	if (env.NPMPRO_TEST_ROOT && env.NPMPRO_TEST_ARGON2 === "fast") return TEST;
	return minimal ? MINIMAL : STRONG;
};

/**
 * Hashes a secret with argon2id, encoded as JSON, with the cost of hashParams()
 *
 * @param   {String}  plain
 * @param   {Boolean} minimal
 * @returns {Promise<String>}
 */
const hash = async (plain, minimal = false) => {
	const params = hashParams(minimal);
	const nonce = randomBytes(16);
	const tag = await derive("argon2id", { message: plain, nonce, tagLength: 32, ...params });

	return JSON.stringify({ ...params, nonce: nonce.toString("base64"), tag: tag.toString("base64") });
};

/**
 * Verifies a secret against a stored hash, using the parameters it carries
 *
 * @param   {String} plain
 * @param   {String} stored
 * @returns {Promise<Boolean>}
 */
const verify = async (plain, stored) => {
	try {
		const { nonce, tag, ...params } = JSON.parse(stored);
		const expected = Buffer.from(tag, "base64");
		const actual = await derive("argon2id", {
			message: plain,
			nonce: Buffer.from(nonce, "base64"),
			tagLength: expected.length,
			...params,
		});

		return timingSafeEqual(actual, expected);
	} catch {
		return false;
	}
};

let dummyHash;

/**
 * Runs a full verify against a fixed hash and answers false: a sign-in for an unknown, disabled or passwordless account
 * then costs the same time as a wrong password, so the answer time does not tell which emails exist. The hash is made
 * once, at first use, with the default parameters of hash().
 *
 * @param   {String} plain
 * @returns {Promise<false>}
 */
const verifyDummy = async (plain) => {
	dummyHash ??= hash(randomBytes(32).toString("base64"));
	await verify(String(plain ?? ""), await dummyHash);
	return false;
};

// an object, so the sign-in calls it through a property a test can watch
const loginTiming = { verifyDummy };

export { hash, hashParams, loginTiming, verify };
