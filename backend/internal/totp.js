import { createGuardrails, generateSecret, generateURI, verify } from "otplib";
import { maintenance } from "../lib/database/maintenance.js";
import errs from "../lib/error.js";
import { isSealed, openSecret, sealSecret } from "../lib/totp-secret.js";
import authModel from "../models/auth.js";
import now from "../models/now_helper.js";
import userModel from "../models/user.js";
import internalAuditLog from "./audit-log.js";
import internalUser from "./user.js";

const APP_NAME = "NPMpro";

const usedSteps = new Map();
const startStep = Math.floor(Date.now() / 30000);

const internalTotp = {
	/**
	 * @param {number} userId
	 * @returns {Promise<boolean>}
	 */
	isEnabled: async (userId, trx) =>
		(await authModel.query(trx).where("user_id", userId).andWhere("type", "totp").resultSize()) > 0,

	/**
	 * Stores the pending secret
	 *
	 * @param   {Access}  access
	 * @param   {number} userId
	 * @returns {Promise<{secret: string, otpauth_url: string}>}
	 */
	startSetup: async (access, userId) => {
		if (Number(userId) !== access.token.getUserId(0)) {
			throw new errs.PermissionError("TOTP can only be managed for your own account");
		}
		const user = await internalUser.get(access, { id: userId });

		if (await internalTotp.isEnabled(userId)) {
			throw new errs.ValidationError("TOTP is already enabled");
		}

		const secret = generateSecret();
		const otpauth_url = generateURI({
			issuer: APP_NAME,
			label: user.email,
			secret,
		});

		await authModel.transaction(async (trx) => {
			await authModel.query(trx).where("user_id", userId).andWhere("type", "totp_pending").delete();
			await authModel
				.query(trx)
				.insert({ user_id: userId, type: "totp_pending", secret: sealSecret(secret), meta: {} });
		});

		return { secret, otpauth_url };
	},

	/**
	 * @param   {Access}  access
	 * @param   {number}  userId
	 * @param   {string}  code
	 * @returns {Promise<void>}
	 */
	enable: async (access, userId, code, onEnable) => {
		if (Number(userId) !== access.token.getUserId(0)) {
			throw new errs.PermissionError("TOTP can only be managed for your own account");
		}
		const user = await internalUser.get(access, { id: userId });

		if (await internalTotp.isEnabled(userId)) {
			throw new errs.ValidationError("TOTP is already enabled");
		}

		const pending = await authModel
			.query()
			.select("*", now().as("now"))
			.where("user_id", userId)
			.andWhere("type", "totp_pending")
			.first();

		if (!pending) {
			throw new errs.ValidationError("No pending TOTP setup found");
		}

		// a setup which was not confirmed within 10 minutes has to be started again
		if (new Date(pending.now).getTime() - new Date(pending.created_on).getTime() > 600000) {
			throw new errs.ValidationError("TOTP setup has expired");
		}

		const result = await verify({ token: code, secret: openSecret(pending.secret) });
		if (!result.valid) {
			throw new errs.ValidationError("Invalid verification code", "error.invalid-code");
		}

		await authModel.transaction(async (trx) => {
			const enabled = await authModel
				.query(trx)
				.findById(pending.id)
				.andWhere("type", "totp_pending")
				.patch({ type: "totp" });

			if (enabled !== 1) {
				throw new errs.ValidationError("No pending TOTP setup found");
			}

			await userModel
				.query(trx)
				.where("id", userId)
				.patch({ npmpro_token_valid_after: Math.floor(Date.now() / 1000) });

			await onEnable?.(trx);
		});
		usedSteps.set(pending.id, result.timeStep);

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "user",
			object_id: user.id,
			meta: {
				name: user.name,
				totp_enabled: true,
			},
		});
	},

	/**
	 * Checks and code verification happen on the MFA layer
	 *
	 * @param   {Access}  access
	 * @param   {number}  userId
	 * @param   {boolean} skipAudit
	 * @returns {Promise<void>}
	 */
	disable: async (access, userId, skipAudit, onDisable) => {
		await authModel.transaction(async (trx) => {
			await authModel.query(trx).where("user_id", userId).whereIn("type", ["totp", "totp_pending"]).delete();
			await onDisable?.(trx);
		});

		if (!skipAudit) {
			const user = await internalUser.get(access, { id: userId });
			await internalAuditLog.add(access, {
				action: "updated",
				object_type: "user",
				object_id: user.id,
				meta: {
					name: user.name,
					totp_enabled: false,
				},
			});
		}
	},

	/**
	 * @param   {number} userId
	 * @param   {string} code
	 * @returns {Promise<boolean>}
	 */
	verifyCode: async (userId, code) => {
		const enrolled = await authModel.query().where("user_id", userId).andWhere("type", "totp").first();

		if (!enrolled) {
			return false;
		}

		let secret;
		try {
			secret = openSecret(enrolled.secret);
		} catch {
			// the encryption key changed: the code cannot be checked (backup codes still work)
			return false;
		}
		const result = await verify({
			token: code,
			secret,
			// otplib v12 accepted secrets of 10 bytes (v13: 16); v12 secrets exist, so keep 10 or users are locked out
			guardrails: createGuardrails({
				MIN_SECRET_BYTES: 10,
			}),
		});

		if (!result.valid || (usedSteps.get(enrolled.id) ?? startStep) >= result.timeStep) return false;

		usedSteps.set(enrolled.id, result.timeStep);
		// not during a database move: the secret is sealed at a later login
		const release = isSealed(enrolled.secret) ? null : maintenance.tryBeginWrite();
		if (release) {
			try {
				await authModel
					.query()
					.findById(enrolled.id)
					.patch({ secret: sealSecret(secret) });
			} finally {
				release();
			}
		}
		return true;
	},
};

export default internalTotp;
