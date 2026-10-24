import express from "express";
import { rateLimit } from "express-rate-limit";
import {
	authorizationCodeGrant,
	buildAuthorizationUrl,
	calculatePKCECodeChallenge,
	fetchUserInfo,
	randomNonce,
	randomPKCECodeVerifier,
	randomState,
} from "openid-client";
import internalToken from "../internal/token.js";
import errs from "../lib/error.js";
import { getDiscovery, getOidcConfig, readStoredOidc } from "../lib/oidc-config.js";
import { ICON_MIME, readIconFile } from "../lib/oidc-icon.js";
import {
	claimsErrorCode,
	FLOW_COOKIE_NAMES,
	hasFlowCookies,
	logValue,
	oidcErrorCode,
	oidcErrorUrl,
} from "../lib/oidc-login.js";
import { callbackUrl } from "../lib/oidc-rules.js";
import { oidc as logger } from "../logger.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

const limiter = rateLimit({
	windowMs: 5 * 60 * 1000,
	limit: 10,
	standardHeaders: "draft-8",
	legacyHeaders: false,
	ipv6Subnet: 48,
});

/**
 * GET /api/oidc/icon
 *
 * Public login button icon. Registered before the rate limiter because the
 * login page loads it on every visit.
 */
router.get("/icon", async (_, res) => {
	const icon = (await readStoredOidc()).button?.icon;
	const file = icon?.type === "file" ? await readIconFile(icon.ext) : null;
	if (!file) throw new errs.ItemNotFoundError("icon");
	res.set({
		"Content-Type": ICON_MIME[icon.ext],
		"X-Content-Type-Options": "nosniff",
		"Cache-Control": "public, max-age=86400",
	});
	if (icon.ext === "svg") {
		res.set({
			"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
			"Content-Disposition": "inline",
		});
	}
	res.status(200).send(file);
});

router.use(limiter);

const FLOW_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "Lax" };

const setNoRedirect = (res) => {
	res.cookie("__Host-npmpro_oidc_no_redirect", "true", {
		secure: true,
		sameSite: "Strict",
		maxAge: 60 * 60 * 1000,
	});
};

const setFlowCookie = (res, name, value) => {
	res.cookie(name, value, { ...FLOW_COOKIE_OPTIONS, signed: true, maxAge: 15 * 60 * 1000 });
};

const clearFlowCookies = (res) => {
	for (const name of FLOW_COOKIE_NAMES) res.clearCookie(name, FLOW_COOKIE_OPTIONS);
};

/**
 * Ends the flow on the login page with an error code (details stay in the log)
 */
const fail = (res, code) => {
	setNoRedirect(res);
	clearFlowCookies(res);
	res.redirect(oidcErrorUrl(code));
};

router
	.route("/")

	/**
	 * GET /api/oidc
	 *
	 * OAuth Authorization Code flow initialisation
	 */
	.get(async (_, res) => {
		try {
			const cfg = await getOidcConfig();
			if (!cfg.active) return fail(res, "not_configured");

			const config = await getDiscovery(cfg.values);

			const code_verifier = randomPKCECodeVerifier();
			const parameters = {
				redirect_uri: callbackUrl(cfg.values.redirect_domain),
				scope: cfg.values.scopes,
				state: randomState(),
				nonce: randomNonce(),
				code_challenge_method: "S256",
				code_challenge: await calculatePKCECodeChallenge(code_verifier),
			};

			setNoRedirect(res);
			setFlowCookie(res, "__Host-Http-npmpro_oidc_code_verifier", code_verifier);
			setFlowCookie(res, "__Host-Http-npmpro_oidc_state", parameters.state);
			setFlowCookie(res, "__Host-Http-npmpro_oidc_nonce", parameters.nonce);

			res.redirect(buildAuthorizationUrl(config, parameters).toString());
		} catch (err) {
			logger.error(`Init error: ${logValue(err.message)}`);
			fail(res, "provider_error");
		}
	});

/**
 * Exchanges the code (state, nonce and PKCE are verified by openid-client) and returns the claims
 */
const exchangeCode = async (req, values) => {
	const config = await getDiscovery(values);

	const tokens = await authorizationCodeGrant(config, new URL(`${req.protocol}://${req.host}${req.originalUrl}`), {
		pkceCodeVerifier: req.signedCookies?.["__Host-Http-npmpro_oidc_code_verifier"],
		expectedState: req.signedCookies?.["__Host-Http-npmpro_oidc_state"],
		expectedNonce: req.signedCookies?.["__Host-Http-npmpro_oidc_nonce"],
		idTokenExpected: true,
	});

	const idTokenClaims = tokens.claims();
	if (idTokenClaims.email) return idTokenClaims;

	const userinfo = await fetchUserInfo(config, tokens.access_token, idTokenClaims.sub);
	return { ...idTokenClaims, ...userinfo };
};

router
	.route("/callback")

	/**
	 * GET /api/oidc/callback
	 *
	 * Oauth Authorization Code flow callback
	 */
	.get(async (req, res) => {
		let cfg;
		let claims;
		try {
			cfg = await getOidcConfig();
			if (!cfg.active) return fail(res, "not_configured");
			if (!hasFlowCookies(req.signedCookies)) {
				logger.error("Callback without a started login");
				return fail(res, "provider_error");
			}
			claims = await exchangeCode(req, cfg.values);
		} catch (err) {
			logger.error(`Callback error: ${logValue(err.message)}`);
			return fail(res, "provider_error");
		}

		const claimsError = claimsErrorCode(claims, cfg.values);
		if (claimsError) {
			logger.error(`Callback refused (${claimsError}) for subject ${logValue(claims?.sub)}`);
			return fail(res, claimsError);
		}

		const email = claims.email.toLowerCase().trim();
		let data;
		try {
			data = await internalToken.getTokenFromOAuthClaim({ identity: email, claims, config: cfg.values });
		} catch (err) {
			const code = oidcErrorCode(err);
			logger.error(`Login refused (${code}) for email ${logValue(email)}: ${logValue(err.message)}`);
			return fail(res, code);
		}

		logger.info(`Successful authentication for email: ${logValue(email)}`);
		clearFlowCookies(res);

		if (data.requiresTotp) {
			res.cookie("__Host-Http-challenge_token", data.token, {
				signed: true,
				httpOnly: true,
				secure: true,
				sameSite: "Strict",
				expires: new Date(data.expires),
			});
			res.cookie("__Host-npmpro_oidc_totp_required", "true", {
				secure: true,
				sameSite: "Strict",
				expires: new Date(data.expires),
			});
		} else {
			res.cookie("__Host-Http-token", data.token, {
				signed: true,
				httpOnly: true,
				secure: true,
				sameSite: "Strict",
				expires: new Date(data.expires),
			});
		}
		res.redirect("/");
	});

export default router;
