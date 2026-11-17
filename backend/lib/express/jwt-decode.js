import Access from "../access.js";
import { bearerOf } from "../api-token.js";
import errs from "../error.js";
import { createAuthLimiter } from "./auth-limiter.js";

const COOKIE = "__Host-Http-token";

// failed bearer attempts per address, like the sign-in: only a 401 counts, only requests with a bearer, and a request
// that passes several routers is counted once
const bearerLimiter = createAuthLimiter({
	skip: (req) => req.npmproBearerSeen === true || bearerOf(req.get("authorization")) === null,
	requestWasSuccessful: (_, res) => res.statusCode !== 401,
});

const decodeBearer = async (bearer, req, res, next) => {
	req.npmproBearerSeen = true;
	if (req.signedCookies?.[COOKIE]) {
		return res.status(400).json({ error: { message: "Send a session cookie or an API token, not both" } });
	}
	try {
		const access = new Access(null, { apiToken: bearer });
		await access.load();
		res.locals.access = access;
		return next();
	} catch (error) {
		if (!(error instanceof errs.AuthError)) return next(error);
		res.set("WWW-Authenticate", 'Bearer error="invalid_token"');
		return res.status(401).json({ error: { message: error.message } });
	}
};

const decode = async (req, res, next) => {
	if (res.locals.access) return next();
	const bearer = bearerOf(req.get("authorization"));
	if (bearer !== null) return decodeBearer(bearer, req, res, next);

	const token = req.signedCookies?.[COOKIE] || null;

	try {
		const access = new Access(token);
		await access.load();
		res.locals.access = access;
		next();
	} catch {
		res.clearCookie(COOKIE, {
			httpOnly: true,
			secure: true,
			sameSite: "Strict",
		});
		if (token) {
			res.cookie("__Host-npmpro_oidc_no_redirect", "true", {
				secure: true,
				sameSite: "Strict",
				maxAge: 60 * 60 * 1000,
			});
		}
		return res.status(401).json({
			error: {
				message: "Invalid or expired token",
			},
		});
	}
};

export default () => [bearerLimiter, decode];
