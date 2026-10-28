import { rm } from "node:fs/promises";
import express from "express";
import internalBackup, { backupStore } from "../internal/backup-service.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import apiValidator from "../lib/validator/api.js";
import { getValidationSchema } from "../schema/index.js";

/**
 * /api/backups
 */
const router = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

const FALLBACK_NAME = "npmpro-backup.npmpro";

// sends the file; a pending download is removed afterwards, sent or not.
// dotfiles: pending downloads are stored as .pending-<id>.npmpro, which send ignores (404) by default
const sendFile = (res, file, name, { once = false } = {}) =>
	new Promise((resolve, reject) => {
		res.status(200).download(file, name, { dotfiles: "allow" }, async (err) => {
			if (once) await rm(file, { force: true });
			if (err && !res.headersSent) reject(err);
			else resolve();
		});
	});

router
	.route("/types")
	.all(jwtdecode())

	/**
	 * GET /api/backups/types
	 */
	.get(async (_req, res) => {
		res.status(200).send(await internalBackup.types(res.locals.access));
	});

router
	.route("/")
	.all(jwtdecode())

	/**
	 * GET /api/backups
	 */
	.get(async (_req, res) => {
		res.status(200).send(await internalBackup.list(res.locals.access));
	})

	/**
	 * POST /api/backups
	 */
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/backups", "post"), req.body);
		res.status(200).send(await internalBackup.create(res.locals.access, payload));
	});

router
	.route("/upload")
	.all(jwtdecode())

	/**
	 * POST /api/backups/upload?name=<file name>
	 *
	 * The raw file is the body, streamed to disk by the service
	 */
	.post(async (req, res) => {
		const name = typeof req.query.name === "string" ? req.query.name : undefined;
		res.status(200).send({ entry: await internalBackup.upload(res.locals.access, req, { name }) });
	});

router
	.route("/pending/:id")
	.all(jwtdecode())

	/**
	 * GET /api/backups/pending/:id
	 *
	 * Once: the file is removed after it is sent. ?name= is the file name offered to the browser.
	 */
	.get(async (req, res) => {
		const file = internalBackup.takePending(res.locals.access, req.params.id);
		const { name } = req.query;
		await sendFile(res, file, backupStore.isDownloadName(name) ? name : FALLBACK_NAME, {
			once: true,
		});
	});

router
	.route("/export/preview")
	.all(jwtdecode())

	/**
	 * POST /api/backups/export/preview
	 */
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/backups/export/preview", "post"), req.body);
		const { items, linked, secretsAllowed } = await internalBackup.exportPreview(res.locals.access, payload);
		res.status(200).send({ items, linked, secrets_allowed: secretsAllowed });
	});

router
	.route("/export")
	.all(jwtdecode())

	/**
	 * POST /api/backups/export
	 */
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/backups/export", "post"), req.body);
		res.status(200).send(await internalBackup.exportItems(res.locals.access, payload));
	});

router
	.route("/import")
	.all(jwtdecode())

	/**
	 * POST /api/backups/import?kind=<kind>
	 *
	 * The raw file is the body, streamed to disk by the service
	 */
	.post(async (req, res) => {
		// the service rejects an unknown kind
		const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
		res.status(200).send(await internalBackup.importUpload(res.locals.access, req, { kind }));
	});

router
	.route("/import/:id/open")
	.all(jwtdecode())

	/**
	 * POST /api/backups/import/:id/open
	 */
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/backups/import/{id}/open", "post"), req.body);
		res.status(200).send(await internalBackup.importOpen(res.locals.access, req.params.id, payload));
	});

router
	.route("/restore/:token/plan")
	.all(jwtdecode())

	/**
	 * POST /api/backups/restore/:token/plan
	 */
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/backups/restore/{token}/plan", "post"), req.body);
		res.status(200).send(await internalBackup.plan(res.locals.access, req.params.token, payload));
	});

router
	.route("/restore/:token/check")
	.all(jwtdecode())

	/**
	 * POST /api/backups/restore/:token/check
	 */
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/backups/restore/{token}/check", "post"), req.body);
		res.status(200).send(await internalBackup.check(res.locals.access, req.params.token, payload));
	});

router
	.route("/restore/:token")
	.all(jwtdecode())

	/**
	 * POST /api/backups/restore/:token
	 */
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/backups/restore/{token}", "post"), req.body);
		const { plan_hash: planHash, confirm: _confirm, ...options } = payload;
		try {
			res.status(200).send(
				await internalBackup.restore(res.locals.access, req.params.token, { ...options, planHash }),
			);
		} catch (err) {
			// the error handler does not send payloads: the new plan goes with the 409
			if (err.code !== "plan-changed" || !err.payload) throw err;
			res.status(409).send({
				error: { code: 409, message: err.message, message_i18n: err.message_i18n, plan: err.payload.plan },
			});
		}
	})

	/**
	 * DELETE /api/backups/restore/:token
	 */
	.delete((req, res) => {
		internalBackup.cancel(res.locals.access, req.params.token);
		res.status(200).send(true);
	});

router
	.route("/:name/inspect")
	.all(jwtdecode())

	/**
	 * POST /api/backups/:name/inspect
	 */
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/backups/{name}/inspect", "post"), req.body);
		res.status(200).send(await internalBackup.inspect(res.locals.access, req.params.name, payload));
	});

router
	.route("/:name")
	.all(jwtdecode())

	/**
	 * GET /api/backups/:name
	 */
	.get(async (req, res) => {
		const file = await internalBackup.download(res.locals.access, req.params.name);
		await sendFile(res, file, req.params.name);
	})

	/**
	 * DELETE /api/backups/:name
	 */
	.delete(async (req, res) => {
		await internalBackup.remove(res.locals.access, req.params.name);
		res.status(200).send(true);
	});

export default router;
