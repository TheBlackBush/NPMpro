import errs from "../error.js";

// routes that act on the signed-in account itself (password, MFA, sessions, avatar, OIDC link, API tokens): an API
// token is refused there, so a script cannot take over or widen its own account (spec rule 3)
export default () => (_, res, next) =>
	next(
		res.locals.access?.apiToken
			? new errs.PermissionError("API tokens cannot be used for this request")
			: undefined,
	);
