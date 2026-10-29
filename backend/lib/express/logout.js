import errs from "../error.js";

/**
 * DELETE /tokens: logout ends the whole session, every other copy of its tokens stops working too. While a database
 * move restarts the backend the logout cannot be stored: it answers that error (409) and keeps the cookie, so the
 * user stays signed in and can log out again after the restart.
 *
 * @param   {Object}    deps
 * @param   {Function}  deps.revokeSession  (tokenData) => Promise
 * @param   {Function}  deps.loadToken      (token) => tokenData, throws for an invalid token
 * @returns {Function}  the express handler
 */
const createLogoutHandler =
	({ revokeSession, loadToken }) =>
	async (req, res) => {
		const token = req.signedCookies?.["__Host-Http-token"];
		if (token) {
			try {
				await revokeSession(loadToken(token));
			} catch (error) {
				if (error instanceof errs.DatabaseMoveError) throw error;
				// an expired or invalid token has no session left to end
			}
		}
		res.clearCookie("__Host-Http-token", {
			httpOnly: true,
			secure: true,
			sameSite: "Strict",
		});
		res.cookie("__Host-npmpro_oidc_no_redirect", "true", {
			secure: true,
			sameSite: "Strict",
			maxAge: 60 * 60 * 1000,
		});
		res.status(200).send({ expires: new Date(0).toISOString() });
	};

export { createLogoutHandler };
