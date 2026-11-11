/**
 * "scope" is where a token came from and what uses it ("user" or "mfa-challenge"); not the "role" ("user" or "admin").
 */

import TokenModel from "../models/token.js";
import userModel from "../models/user.js";
import errs from "./error.js";
import { isSessionRevoked } from "./session.js";

export default function (tokenString) {
	const Token = TokenModel();
	let initialised = false;
	let isAdmin = false;
	let permissions = {};

	/**
	 * @returns {Promise}
	 */
	const init = async () => {
		if (initialised) {
			return;
		}

		if (!tokenString) {
			throw new errs.PermissionError();
		}

		const tokenData = Token.load(tokenString);

		// The user must exist and still have the token's scopes; checked when the token has a user id or the `user` scope.
		if (tokenData.attrs.id || tokenData.scope?.includes("user")) {
			const user = await userModel
				.query()
				.where("id", tokenData.attrs.id)
				.andWhere("is_disabled", 0)
				.allowGraph("[permissions]")
				.withGraphFetched("[permissions]")
				.first();

			if (user) {
				if (tokenData.iat <= user.npmpro_token_valid_after || (await isSessionRevoked(tokenData.sid))) {
					throw new errs.PermissionError("Token has been revoked");
				}

				// The `user` role is not stored on the user row, so it is added here to pass this check.
				user.roles.push("user");

				if (!(tokenData.scope ?? []).every((scopeItem) => user.roles.includes(scopeItem))) {
					throw new errs.PermissionError("Invalid token scope for User");
				}
				isAdmin = user.roles.includes("admin");
				permissions = user.permissions ?? {};
			} else {
				throw new errs.PermissionError("User cannot be loaded for Token");
			}
		}
		initialised = true;
	};

	return {
		token: Token,

		get visibility() {
			return permissions.visibility;
		},

		/**
		 * Non-throwing admin check, valid after load()
		 *
		 * @returns {Boolean}
		 */
		get isAdmin() {
			return isAdmin;
		},

		/**
		 *
		 * @returns {Boolean}
		 */
		canAdmin: () => {
			if (isAdmin) return true;
			throw new errs.PermissionError();
		},

		/**
		 *
		 * @param   {Integer}  id
		 * @returns {Boolean}
		 */
		canUser: (id) => {
			if (isAdmin || Number(id) === Token.getUserId(0)) return true;
			throw new errs.PermissionError();
		},

		/**
		 *
		 * @param   {Boolean}  [allowInternal]
		 * @returns {Promise}
		 */
		load: (allowInternal) => {
			if (!tokenString && allowInternal) {
				initialised = true;
				isAdmin = true;
				permissions = { visibility: "all" };
			}
			return init();
		},

		/**
		 *
		 * @param {String}  permission
		 * @returns {Boolean}
		 */
		can: (permission) => {
			const [type, required] = permission.split(":");
			const level = permissions[type];
			if (isAdmin || level === "manage" || level === required) return true;
			throw new errs.PermissionError();
		},
	};
}
