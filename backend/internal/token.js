import { carryAuthMethod } from "../lib/auth-method.js";
import { maintenance } from "../lib/database/maintenance.js";
import errs from "../lib/error.js";
import { parseDatePeriod } from "../lib/helpers.js";
import { identityOf, linkAction } from "../lib/oidc-identity.js";
import { OidcLoginError } from "../lib/oidc-login.js";
import { emailDomainAllowed } from "../lib/oidc-rules.js";
import { continueSession, newSession } from "../lib/session.js";
import { oidc as logger } from "../logger.js";
import auditLogModel from "../models/audit-log.js";
import authModel from "../models/auth.js";
import TokenModel from "../models/token.js";
import userModel from "../models/user.js";
import mfa from "./mfa.js";
import { createOidcIdentity } from "./oidc-identity.js";
import oidcProvision from "./oidc-provision.js";
import totp from "./totp.js";

const ERROR_MESSAGE_INVALID_AUTH = "Invalid email or password";
const ERROR_MESSAGE_INVALID_AUTH_I18N = "error.invalid-auth";
const ERROR_MESSAGE_INVALID_CODE = "Invalid verification code";
const ERROR_MESSAGE_INVALID_CODE_I18N = "error.invalid-code";

const consumedChallenges = new Map();
const startTime = Math.floor(Date.now() / 1000);

// internal/user.js builds its own instance with the same options (it imports this file, so it cannot be shared)
const oidcIdentity = createOidcIdentity({
	knex: userModel.knex(),
	audit: (row) => auditLogModel.query().insert(row),
	tryBeginWrite: maintenance.tryBeginWrite,
});

// the identity an OIDC sign-in links once its second factor is verified (R7): challenge jti => {issuer, subject, exp},
// kept here so the subject never reaches the browser; a restart drops it, and the challenge tokens with it
const pendingLinks = new Map();
const CHALLENGE_SECONDS = 180;

const prunePendingLinks = () => {
	const now = Math.floor(Date.now() / 1000);
	for (const [jti, pending] of pendingLinks) if (pending.exp <= now) pendingLinks.delete(jti);
};

/**
 * Audits (skipped during a database move, R3) and logs a refused OIDC sign-in, without the subject
 *
 * @param   {Object}  user    the user the refusal is filed under
 * @param   {string}  issuer
 * @param   {string}  reason  the log line
 */
const recordRefusal = async (user, issuer, reason) => {
	logger.error(reason);
	const release = maintenance.tryBeginWrite();
	if (!release) return;
	try {
		await auditLogModel.query().insert({
			user_id: user.id,
			action: "oidc-refused",
			object_type: "user",
			object_id: user.id,
			meta: { name: user.name, email: user.email, issuer },
		});
	} finally {
		release();
	}
};

/**
 * Refuses a sign-in whose identity is linked elsewhere: audited and logged
 *
 * @param   {Object}  user
 * @param   {{issuer: string, subject: string}}  identity
 */
const refuseMismatch = async (user, identity) => {
	await recordRefusal(user, identity.issuer, `Sign-in of user ${user.id} refused, it is linked to another identity`);
	throw new OidcLoginError("identity_mismatch", `User ${user.id} is linked to another identity`);
};

/**
 * Writes the link (R7: once the session is granted); a unique violation means another user took the identity first
 *
 * @param   {Object}  user
 * @param   {{issuer: string, subject: string}}  identity
 * @param   {"link"|"relink"}  action
 * @returns {Promise<boolean>}  false when the identity belongs to another user (refuse the sign-in)
 */
const writeLink = async (user, identity, action) => {
	const outcome = await oidcIdentity.link(user, identity, action);
	if (outcome === "skipped") logger.info(`Link of user ${user.id} skipped, a database move is running`);
	return outcome !== "mismatch";
};

/**
 * Links the identity an OIDC challenge waited for, after its code was verified. The decision is made again on the
 * current rows: another user may have taken the identity while the challenge was open, which refuses the session.
 *
 * @param   {Object}  user  the user row, read after the challenge
 * @param   {{issuer: string, subject: string}}  identity
 */
const linkAfterChallenge = async (user, identity) => {
	const action = linkAction(user, identity, await oidcIdentity.holderOf(identity));
	if (action === "ok") return;
	if (action !== "mismatch" && (await writeLink(user, identity, action))) return;
	await recordRefusal(
		user,
		identity.issuer,
		`Sign-in of user ${user.id} refused after the second factor, the identity is linked elsewhere`,
	);
	throw new errs.PermissionError(
		"This account is linked to another account at the sign-in provider",
		"login.oidc-error.identity_mismatch",
	);
};

export default {
	/**
	 * @param   {Object} data
	 * @param   {String} data.identity
	 * @param   {String} data.secret
	 * @returns {Promise}
	 */
	getTokenFromEmail: async (data) => {
		const Token = TokenModel();

		const user = await userModel
			.query()
			.where("email", data.identity.toLowerCase())
			.andWhere("is_disabled", 0)
			.first();

		if (!user) {
			throw new errs.PermissionError(ERROR_MESSAGE_INVALID_AUTH, ERROR_MESSAGE_INVALID_AUTH_I18N);
		}

		const auth = await authModel.getPasswordAuth(user.id);

		if (!auth) {
			throw new errs.PermissionError(ERROR_MESSAGE_INVALID_AUTH, ERROR_MESSAGE_INVALID_AUTH_I18N);
		}

		const valid = await auth.verifyPassword(data.secret);
		if (!valid) {
			throw new errs.PermissionError(ERROR_MESSAGE_INVALID_AUTH, ERROR_MESSAGE_INVALID_AUTH_I18N);
		}

		const hasMfa = await mfa.isAnyEnabled(user.id);
		if (hasMfa) {
			if (data.code) {
				const validCode = await mfa.verifyForLogin(user.id, data.code);
				if (!validCode) {
					throw new errs.PermissionError(ERROR_MESSAGE_INVALID_CODE, ERROR_MESSAGE_INVALID_CODE_I18N);
				}
			} else {
				const challengeToken = Token.create({
					iss: "api",
					attrs: {
						id: user.id,
						auth_method: "password",
					},
					scope: ["mfa-challenge"],
					expiresIn: "3m",
				});

				return {
					requiresTotp: await totp.isEnabled(user.id),
					token: challengeToken.token,
					expires: parseDatePeriod("3m").toISOString(),
				};
			}
		}

		const signed = Token.create({
			iss: "api",
			attrs: {
				id: user.id,
				auth_method: "password",
			},
			scope: ["user"],
			expiresIn: "1h",
			...newSession(),
		});

		return {
			token: signed.token,
			expires: parseDatePeriod("1h").toISOString(),
		};
	},

	/**
	 * Logs in the user that owns the provider's email, creating it when auto-create allows
	 *
	 * @param   {Object} data
	 * @param   {String} data.identity  lower-cased, trimmed email
	 * @param   {Object} data.claims    provider claims
	 * @param   {Object} data.config    effective OIDC settings (getOidcConfig().values)
	 * @returns {Promise}
	 */
	getTokenFromOAuthClaim: async ({ identity: rawIdentity, claims, config }) => {
		const Token = TokenModel();
		const email = String(rawIdentity).toLowerCase().trim();
		const identity = identityOf(claims);
		if (!identity) throw new OidcLoginError("provider_error", "The provider sent no usable issuer and subject");

		let user = await userModel.query().where("email", email).orderBy("is_disabled").orderBy("id").first();
		const holderId = await oidcIdentity.holderOf(identity);

		// a subject linked to another user may not create a second account (R2): filed under the holder
		if (!user && holderId !== null) {
			const reason = `Sign-in refused, the identity is linked to user ${holderId} and may not create another account`;
			const holder = await userModel.query().findById(holderId);
			// a holder deleted in between leaves no user to file the refusal under: logged only
			if (holder) await recordRefusal(holder, identity.issuer, reason);
			else logger.error(reason);
			throw new OidcLoginError("identity_mismatch", `The identity is linked to user ${holderId}`);
		}
		if (!user) {
			if (!config.auto_create?.enabled) throw new OidcLoginError("no_user", `No user for ${email}`);
			if (!emailDomainAllowed(email, config.auto_create.allowed_domains)) {
				throw new OidcLoginError("domain_not_allowed", `Domain of ${email} is not allowed`);
			}
			user = await oidcProvision.createUser({ ...claims, email }, config.auto_create.permissions);
		}

		if (user.is_disabled) throw new OidcLoginError("user_disabled", `User for ${email} is disabled`);

		// a mismatch is refused before any challenge; the link itself is written once the session is granted (R7)
		const action = linkAction(user, identity, holderId);
		if (action === "mismatch") await refuseMismatch(user, identity);

		const hasMfa = await mfa.isAnyEnabled(user.id);
		if (hasMfa && !config.skip_mfa) {
			const challengeToken = Token.create({
				iss: "api",
				attrs: {
					id: user.id,
					auth_method: "oidc",
				},
				scope: ["mfa-challenge"],
				expiresIn: `${CHALLENGE_SECONDS}s`,
			});
			if (action !== "ok") {
				prunePendingLinks();
				pendingLinks.set(challengeToken.payload.jti, {
					issuer: identity.issuer,
					subject: identity.subject,
					exp: Math.floor(Date.now() / 1000) + CHALLENGE_SECONDS,
				});
			}

			return {
				requiresTotp: await totp.isEnabled(user.id),
				token: challengeToken.token,
				expires: parseDatePeriod("3m").toISOString(),
			};
		}

		if (action !== "ok" && !(await writeLink(user, identity, action))) await refuseMismatch(user, identity);

		const signed = Token.create({
			iss: "api",
			attrs: {
				id: user.id,
				auth_method: "oidc",
			},
			scope: ["user"],
			expiresIn: "1h",
			...newSession(),
		});

		return {
			token: signed.token,
			expires: parseDatePeriod("1h").toISOString(),
		};
	},

	/**
	 * @param {Access} access
	 * @returns {Object}
	 */
	getFreshToken: (access, afterRevoke) => {
		const Token = TokenModel();

		if (access?.token.getUserId(0) && access.token.hasScope("user")) {
			const signed = Token.create({
				iss: "api",
				scope: ["user"],
				attrs: {
					id: access.token.getUserId(0),
					auth_method: access.token.getAuthMethod(),
				},
				expiresIn: "1h",
				iat: Math.floor(Date.now() / 1000) + (afterRevoke ? 1 : 0),
				...continueSession(access.token.getSession()),
			});

			return {
				token: signed.token,
				expires: parseDatePeriod("1h").toISOString(),
			};
		}
		throw new errs.AssertionFailedError("Existing token contained invalid user data");
	},

	/**
	 * Verifies the TOTP code and returns the full token
	 * @param {string} challengeToken
	 * @param {string} code
	 * @returns {Promise}
	 */
	verifyTotp: async (challengeToken, code) => {
		const Token = TokenModel();

		let tokenData;
		try {
			tokenData = Token.load(challengeToken);
		} catch (err) {
			throw new errs.AuthError("Invalid or expired challenge token", undefined, { cause: err });
		}

		if (tokenData.scope?.[0] !== "mfa-challenge") {
			throw new errs.AuthError("Invalid challenge token");
		}

		const userId = tokenData.attrs?.id;
		if (!userId) {
			throw new errs.AuthError("Invalid challenge token");
		}

		const user = await userModel.query().where("id", userId).andWhere("is_disabled", 0).first();
		if (!user || tokenData.iat <= user.npmpro_token_valid_after || tokenData.iat <= startTime) {
			throw new errs.AuthError("Invalid challenge token");
		}

		const now = Math.floor(Date.now() / 1000);
		for (const [jti, expires] of consumedChallenges) if (expires <= now) consumedChallenges.delete(jti);

		// Claim the challenge token before the code is checked, so no parallel or repeated request can consume a code
		if (consumedChallenges.has(tokenData.jti)) {
			throw new errs.AuthError("Invalid challenge token");
		}
		consumedChallenges.set(tokenData.jti, tokenData.exp);

		let verified;
		try {
			verified = await mfa.verifyForLogin(userId, code);
		} catch (err) {
			// a backup code refused during a database move used nothing up: the challenge stays valid for a retry
			if (err instanceof errs.DatabaseMoveError) consumedChallenges.delete(tokenData.jti);
			throw err;
		}
		if (!verified) {
			consumedChallenges.delete(tokenData.jti);
			throw new errs.PermissionError(ERROR_MESSAGE_INVALID_CODE, ERROR_MESSAGE_INVALID_CODE_I18N);
		}

		const pending = pendingLinks.get(tokenData.jti);
		pendingLinks.delete(tokenData.jti);
		if (pending) await linkAfterChallenge(user, { issuer: pending.issuer, subject: pending.subject });

		const signed = Token.create({
			iss: "api",
			attrs: {
				id: userId,
				auth_method: carryAuthMethod(tokenData.attrs),
			},
			scope: ["user"],
			expiresIn: "1h",
			...newSession(),
		});

		return {
			token: signed.token,
			expires: parseDatePeriod("1h").toISOString(),
		};
	},
};
