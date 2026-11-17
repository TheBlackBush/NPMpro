import errs from "../error.js";

// routes that act on the signed-in account itself (password, MFA, sessions, avatar, OIDC link, API tokens), the
// settings that decide who can sign in (OIDC, forward authentication) and the nginx auth_request checks: an API token
// is refused there, so a script cannot take over or widen an account (spec rule 3)
export default () => (_, res, next) =>
	next(
		res.locals.access?.apiToken
			? new errs.PermissionError("API tokens cannot be used for this request")
			: undefined,
	);
