import internalApiToken, { nowSeconds } from "../internal/api-token.js";
import { access as logger } from "../logger.js";
import apiTokenModel from "../models/api_token.js";
import userModel from "../models/user.js";
import { parseApiToken, secretMatches } from "./api-token.js";
import errs from "./error.js";

const INVALID = "Invalid or expired token";

/**
 * The token row and its owner for a bearer text, or AuthError (401): unknown, wrong secret, expired, owner disabled or
 * deleted. Any other error (the database) passes through.
 *
 * @param   {string} text
 * @param   {Object} [options]
 * @param   {number} [options.now]  epoch seconds
 * @returns {Promise<{row: Object, user: Object}>}
 */
const authenticateApiToken = async (text, { now = nowSeconds() } = {}) => {
	const parsed = parseApiToken(text);
	if (!parsed) throw new errs.AuthError(INVALID);
	const row = await apiTokenModel.query().where("lookup_id", parsed.lookupId).first();
	if (!(row && secretMatches(parsed.secret, row.secret_hash))) throw new errs.AuthError(INVALID);
	if (row.expires_on !== null && row.expires_on <= now) {
		// the audit entry is best effort: a failure to write it must not turn the 401 into a 500
		await internalApiToken
			.auditExpired(now)
			.catch((error) => logger.warn(`API token expiry audit failed: ${error.message}`));
		throw new errs.AuthError("API token has expired");
	}
	const user = await userModel
		.query()
		.where("id", row.user_id)
		.andWhere("is_disabled", 0)
		.allowGraph("[permissions]")
		.withGraphFetched("[permissions]")
		.first();
	if (!user) throw new errs.AuthError(INVALID);
	return { row, user };
};

export { authenticateApiToken };
