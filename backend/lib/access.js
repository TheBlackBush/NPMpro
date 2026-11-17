/**
 * "scope" is where a token came from and what uses it ("user" or "mfa-challenge"); not the "role" ("user" or "admin").
 */

import internalApiToken from "../internal/api-token.js";
import TokenModel from "../models/token.js";
import userModel from "../models/user.js";
import { authenticateApiToken } from "./api-token-auth.js";
import { effectivePermissions, tokenIsAdmin } from "./api-token-permissions.js";
import errs from "./error.js";
import { isSessionRevoked } from "./session.js";

export default function (tokenString, { apiToken: bearerText = null } = {}) {
	const Token = TokenModel();
	let initialised = false;
	let isAdmin = false;
	let permissions = {};
	let apiToken = null;
	let bearerToken = null;

	/**
	 * @returns {Promise}
	 */
	const init = async () => {
		if (initialised) {
			return;
		}

		if (bearerText !== null) {
			const { row, user } = await authenticateApiToken(bearerText);
			isAdmin = tokenIsAdmin(row, user);
			permissions = effectivePermissions(row, user);
			apiToken = {
				id: row.id,
				name: row.name,
				user_id: row.user_id,
				is_admin: isAdmin,
				allow_delete: row.allow_delete,
			};
			bearerToken = {
				getUserId: (defaultValue) => user.id || defaultValue || 0,
				hasScope: () => false,
				// not an OIDC session: the OIDC settings treat it like a password session
				getAuthMethod: () => "password",
				getSession: () => ({ sid: undefined, auth_time: undefined }),
			};
			await internalApiToken.recordUse(row);
			initialised = true;
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
		get token() {
			return bearerToken ?? Token;
		},

		/** @returns {?{id: number, name: string, user_id: number, is_admin: boolean, allow_delete: boolean}} the API token of a bearer request */
		get apiToken() {
			return apiToken;
		},

		/**
		 * @param   {string} section  proxy_hosts, ...
		 * @returns {"manage"|"view"|"hidden"}
		 */
		level: (section) => (isAdmin ? "manage" : (permissions[section] ?? "hidden")),

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
			if (isAdmin || Number(id) === (bearerToken ?? Token).getUserId(0)) return true;
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
