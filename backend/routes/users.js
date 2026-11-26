import express from "express";
import multer from "multer";
import internalApiToken from "../internal/api-token.js";
import internalMfa from "../internal/mfa.js";
import internalToken from "../internal/token.js";
import internalTotp from "../internal/totp.js";
import internalUser from "../internal/user.js";
import Access from "../lib/access.js";
import { bearerOf } from "../lib/api-token.js";
import errs from "../lib/error.js";
import { createAuthLimiter } from "../lib/express/auth-limiter.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import pathId from "../lib/express/path-id.js";
import sessionOnly from "../lib/express/session-only.js";
import userIdFromMe from "../lib/express/user-id-from-me.js";
import { addMonitoringFlag, createMonitoringAvailable } from "../lib/monitoring-available.js";
import { getMonitoringConfig } from "../lib/monitoring-config.js";
import apiValidator from "../lib/validator/api.js";
import validator from "../lib/validator/index.js";
import { express as logger } from "../logger.js";
import { getValidationSchema } from "../schema/index.js";
import { isSetup } from "../setup.js";

const monitoringAvailable = createMonitoringAvailable({ getConfig: getMonitoringConfig });

const listSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		query: {
			$ref: "common#/properties/query",
		},
	},
};

const userSchema = {
	type: "object",
	required: ["user_id"],
	additionalProperties: false,
	properties: {
		user_id: {
			$ref: "common#/properties/id",
		},
		expand: {
			$ref: "common#/properties/expand",
			items: { enum: ["permissions"] },
		},
	},
};

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

let setupRunning = false;

// a token refused by the user management guard is not a failed sign-in: it does not count toward the limit
const limiter = createAuthLimiter({
	requestWasSuccessful: (_req, res) => res.statusCode < 400 || res.locals.apiTokenRefused === true,
});

router.use(limiter);

// no API token manages users, not even with the Administrator switch (user decision 2026-11-17): a token may only
// read its own user. The setup route is unauthenticated and refuses once a user exists.
const OWN_USER = /^\/(?:me|\d+)$/u;
const userManagementGuard = (req, res, next) => {
	const access = res.locals.access;
	if (!access?.apiToken) return next();
	const own =
		req.method === "GET" &&
		OWN_USER.test(req.path) &&
		(req.path === "/me" || Number(req.path.slice(1)) === access.token.getUserId(0));
	if (own) return next();
	res.locals.apiTokenRefused = true;
	next(new errs.PermissionError("API tokens cannot manage users"));
};

// a bearer is decoded here for every path but /setup (the cookie path stays per route), then the guard runs
const [bearerLimiter, decode] = jwtdecode();
router.use((req, res, next) => {
	if (req.path === "/setup" || bearerOf(req.get("authorization")) === null) return next();
	const after = (step) => (error) => (error ? next(error) : step());
	bearerLimiter(
		req,
		res,
		after(() =>
			decode(
				req,
				res,
				after(() => userManagementGuard(req, res, next)),
			),
		),
	);
});

/**
 * /api/users
 */
router
	.route("/")
	.all(jwtdecode())

	/** GET /api/users */
	.get(async (req, res) => {
		const data = validator(listSchema, {
			query: typeof req.query.query === "string" ? req.query.query : null,
		});
		const users = await internalUser.getAll(res.locals.access, data.query);
		res.status(200).send(users);
	})

	/** POST /api/users */
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/users", "post"), req.body);
		const user = await internalUser.create(res.locals.access, payload);
		res.status(201).send(user);
	});

/**
 * /api/users/setup
 */
router
	.route("/setup")

	/**
	 * POST /api/users/setup
	 *
	 * Create the initial admin User, only possible while no User exists
	 */
	.post(async (req, res) => {
		if (setupRunning) {
			throw new errs.PermissionError();
		}
		setupRunning = true;
		try {
			if (await isSetup()) {
				throw new errs.PermissionError();
			}
			logger.info("Creating a new user in setup mode");

			const access = new Access(null);
			await access.load(true);

			// the first user is always an admin
			const payload = apiValidator(getValidationSchema("/users/setup", "post"), req.body);
			const user = await internalUser.create(access, { ...payload, roles: ["admin"] });
			res.status(201).send(user);
		} finally {
			setupRunning = false;
		}
	});

/**
 * /api/users/123
 */
router
	.route("/:user_id")
	.all(jwtdecode())
	.all(userIdFromMe)

	/** GET /users/123 or /users/me */
	.get(async (req, res) => {
		const data = validator(userSchema, {
			user_id: req.params.user_id,
			expand: typeof req.query.expand === "string" ? req.query.expand.split(",") : null,
		});

		const user = await internalUser.get(res.locals.access, {
			id: data.user_id,
			expand: data.expand,
		});
		// whether the menu shows Monitoring, only for the requesting user itself (not in internal calls or audit logs)
		await addMonitoringFlag(user, res.locals.access.token.getUserId(0), monitoringAvailable);
		res.status(200).send(user);
	})

	/** PUT /api/users/123 */
	.put(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/users/{userID}", "put"), req.body);
		payload.id = req.params.user_id;
		const result = await internalUser.update(res.locals.access, payload);
		res.status(200).send(result);
	})

	/** DELETE /api/users/123 */
	.delete(async (req, res) => {
		const result = await internalUser.delete(res.locals.access, {
			id: req.params.user_id,
		});
		res.status(200).send(result);
	});

/**
 * /api/users/123/auth
 */
router
	.route("/:user_id/auth")
	.all(jwtdecode())
	.all(userIdFromMe)
	.all(sessionOnly())

	/** PUT /api/users/123/auth */
	.put(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/users/{userID}/auth", "put"), req.body);
		payload.id = req.params.user_id;
		const result = await internalUser.setPassword(res.locals.access, payload);
		if (Number(req.params.user_id) === res.locals.access.token.getUserId(0)) {
			const data = internalToken.getFreshToken(res.locals.access, true);
			res.cookie("__Host-Http-token", data.token, {
				signed: true,
				httpOnly: true,
				secure: true,
				sameSite: "Strict",
				expires: new Date(data.expires),
			});
		}
		res.status(200).send(result);
	});

/**
 * /api/users/123/permissions
 */
router
	.route("/:user_id/permissions")
	.all(jwtdecode())
	.all(userIdFromMe)

	/** PUT /api/users/123/permissions */
	.put(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/users/{userID}/permissions", "put"), req.body);
		payload.id = req.params.user_id;
		const result = await internalUser.setPermissions(res.locals.access, payload);
		res.status(200).send(result);
	});

/**
 * /api/users/123/mfa
 */
router
	.route("/:user_id/mfa")
	.all(jwtdecode())
	.all(userIdFromMe)
	.all(sessionOnly())

	/** GET /api/users/123/mfa */
	.get(async (req, res) => {
		const status = await internalMfa.getStatus(res.locals.access, req.params.user_id);
		res.status(200).send(status);
	})

	/**
	 * DELETE /api/users/123/mfa
	 *
	 * Admin reset: disable all second factors and backup codes for a user
	 */
	.delete(async (req, res) => {
		await internalMfa.adminDisable(res.locals.access, req.params.user_id);
		res.status(200).send(true);
	});

/**
 * /api/users/123/mfa/totp
 */
router
	.route("/:user_id/mfa/totp")
	.all(jwtdecode())
	.all(userIdFromMe)
	.all(sessionOnly())

	/** POST /api/users/123/mfa/totp */
	.post(async (req, res) => {
		const result = await internalTotp.startSetup(res.locals.access, req.params.user_id);
		res.status(200).send(result);
	});

/**
 * /api/users/123/mfa/totp/enable
 */
router
	.route("/:user_id/mfa/totp/enable")
	.all(jwtdecode())
	.all(userIdFromMe)
	.all(sessionOnly())

	/** POST /api/users/123/mfa/totp/enable */
	.post(async (req, res) => {
		const { code } = apiValidator(getValidationSchema("/users/{userID}/mfa/totp/enable", "post"), req.body);
		const result = await internalMfa.enableTotp(res.locals.access, req.params.user_id, code);
		const data = internalToken.getFreshToken(res.locals.access, true);
		res.cookie("__Host-Http-token", data.token, {
			signed: true,
			httpOnly: true,
			secure: true,
			sameSite: "Strict",
			expires: new Date(data.expires),
		});
		res.status(200).send(result);
	});

router
	.route("/:user_id/mfa/totp/disable")
	.all(jwtdecode())
	.all(userIdFromMe)
	.all(sessionOnly())

	/** POST /api/users/123/mfa/totp/disable */
	.post(async (req, res) => {
		const { code } = apiValidator(getValidationSchema("/users/{userID}/mfa/totp/disable", "post"), req.body);
		await internalMfa.disableTotp(res.locals.access, req.params.user_id, code);
		res.status(200).send(true);
	});

/**
 * /api/users/123/mfa/backup-codes
 */
router
	.route("/:user_id/mfa/backup-codes")
	.all(jwtdecode())
	.all(userIdFromMe)
	.all(sessionOnly())

	/** POST /api/users/123/mfa/backup-codes */
	.post(async (req, res) => {
		const { code } = apiValidator(getValidationSchema("/users/{userID}/mfa/backup-codes", "post"), req.body);
		const result = await internalMfa.regenerateBackupCodes(res.locals.access, req.params.user_id, code);
		const data = internalToken.getFreshToken(res.locals.access, true);
		res.cookie("__Host-Http-token", data.token, {
			signed: true,
			httpOnly: true,
			secure: true,
			sameSite: "Strict",
			expires: new Date(data.expires),
		});
		res.status(200).send(result);
	});

router
	.route("/:user_id/sessions")
	.all(jwtdecode())
	.all(userIdFromMe)
	.all(sessionOnly())

	/**
	 * DELETE /api/users/123/sessions
	 *
	 * Revoke all of a user's sessions (self or admin)
	 */
	.delete(async (req, res) => {
		await internalUser.revokeSessions(res.locals.access, req.params.user_id);
		if (Number(req.params.user_id) === res.locals.access.token.getUserId(0)) {
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
		}
		res.status(200).send(true);
	});

/**
 * /api/users/123/oidc
 */
router
	.route("/:user_id/oidc")
	.all(jwtdecode())
	.all(userIdFromMe)
	.all(sessionOnly())

	/**
	 * DELETE /api/users/123/oidc
	 *
	 * Remove the user's OIDC identity link (admin)
	 */
	.delete(async (req, res) => {
		await internalUser.unlinkOidc(res.locals.access, req.params.user_id);
		res.status(200).send(true);
	});

/**
 * /api/users/me/language: the UI language of the signed-in user (never with a token)
 */
router
	.route("/me/language")
	.all(jwtdecode())
	.all(sessionOnly())

	/** PUT /api/users/me/language */
	.put(async (req, res) => {
		const { language } = apiValidator(getValidationSchema("/users/me/language", "put"), req.body);
		await internalUser.setLanguage(res.locals.access, language);
		res.status(204).end();
	});

/**
 * /api/users/123/avatar
 */
router
	.route("/:user_id/avatar")
	.all(jwtdecode())
	.all(userIdFromMe)
	.all(sessionOnly())

	/** POST /api/users/123/avatar */
	.post(
		multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } }).single("avatar"),
		async (req, res) => {
			const result = await internalUser.setAvatar(res.locals.access, req.params.user_id, req.file);
			res.status(200).send(result);
		},
	)

	/**
	 * DELETE /api/users/123/avatar
	 *
	 * Remove the custom avatar, falling back to gravatar
	 */
	.delete(async (req, res) => {
		const result = await internalUser.deleteAvatar(res.locals.access, req.params.user_id);
		res.status(200).send(result);
	});

/**
 * /api/users/me/api-tokens: the signed-in user's own API tokens (never with a token)
 */
router
	.route("/:user_id/api-tokens")
	.all(jwtdecode())
	.all(userIdFromMe)
	.all(sessionOnly())

	/** GET /api/users/me/api-tokens */
	.get(async (req, res) => {
		res.status(200).send(await internalApiToken.listOwn(res.locals.access, req.params.user_id));
	})

	/** POST /api/users/me/api-tokens */
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/users/{userID}/api-tokens", "post"), req.body);
		res.status(201).send(await internalApiToken.create(res.locals.access, req.params.user_id, payload));
	});

router.param("token_id", pathId);

/**
 * /api/users/me/api-tokens/123
 */
router
	.route("/:user_id/api-tokens/:token_id")
	.all(jwtdecode())
	.all(userIdFromMe)
	.all(sessionOnly())

	/** DELETE /api/users/me/api-tokens/123 */
	.delete(async (req, res) => {
		res.status(200).send(
			await internalApiToken.revokeOwn(res.locals.access, req.params.user_id, Number(req.params.token_id)),
		);
	});

export default router;
