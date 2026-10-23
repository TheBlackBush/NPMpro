import express from "express";
import multer from "multer";
import internalOidcSetting from "../internal/oidc-setting.js";
import errs from "../lib/error.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import { ICON_MAX_BYTES } from "../lib/oidc-icon.js";
import apiValidator from "../lib/validator/api.js";
import { getValidationSchema } from "../schema/index.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

/**
 * /api/settings/oidc
 */
router
	.route("/")
	.all(jwtdecode())

	/**
	 * GET /api/settings/oidc
	 *
	 * Effective OIDC settings (the client secret is never returned)
	 */
	.get(async (_, res) => {
		res.status(200).send(await internalOidcSetting.get(res.locals.access));
	})

	/**
	 * PUT /api/settings/oidc
	 *
	 * Save the OIDC settings
	 */
	.put(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/settings/oidc", "put"), req.body);
		res.status(200).send(await internalOidcSetting.update(res.locals.access, payload));
	});

/**
 * /api/settings/oidc/test
 */
router
	.route("/test")
	.all(jwtdecode())

	/**
	 * POST /api/settings/oidc/test
	 *
	 * Run discovery with the effective or the submitted connection values
	 */
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/settings/oidc/test", "post"), req.body ?? {});
		res.status(200).send(await internalOidcSetting.test(res.locals.access, payload));
	});

/**
 * Admin check before multer reads the upload
 */
const requireAdmin = (_, res, next) => {
	res.locals.access.canAdmin();
	next();
};

const iconUpload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: ICON_MAX_BYTES, files: 1, fields: 0 },
}).single("file");

/**
 * Multer with the size error reported like the other icon checks
 */
const uploadIcon = (req, res, next) => {
	iconUpload(req, res, (err) => {
		if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
			next(new errs.ValidationError("Icon is too large (max 256 KB)"));
		} else {
			next(err);
		}
	});
};

/**
 * /api/settings/oidc/icon
 */
router
	.route("/icon")
	.all(jwtdecode())
	.all(requireAdmin)

	/**
	 * POST /api/settings/oidc/icon
	 *
	 * Upload a login button icon (PNG, JPEG, WebP or SVG, max 256 KB)
	 */
	.post(uploadIcon, async (req, res) => {
		res.status(200).send(await internalOidcSetting.setIcon(res.locals.access, req.file?.buffer, "uploaded"));
	})

	/**
	 * DELETE /api/settings/oidc/icon
	 *
	 * Remove the icon file, back to the default builtin icon
	 */
	.delete(async (_, res) => {
		res.status(200).send(await internalOidcSetting.deleteIcon(res.locals.access));
	});

/**
 * /api/settings/oidc/icon/url
 */
router
	.route("/icon/url")
	.all(jwtdecode())
	.all(requireAdmin)

	/**
	 * POST /api/settings/oidc/icon/url
	 *
	 * Download a login button icon from a URL
	 */
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/settings/oidc/icon/url", "post"), req.body);
		res.status(200).send(await internalOidcSetting.setIconFromUrl(res.locals.access, payload.url));
	});

export default router;
