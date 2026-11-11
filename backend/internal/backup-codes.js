import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { hash, verify } from "../lib/argon2.js";
import { maintenance } from "../lib/database/maintenance.js";
import authModel from "../models/auth.js";

const codesOf = (userId, trx) => authModel.query(trx).where("user_id", userId).andWhere("type", "backup_code");

/**
 * @returns {Promise<{plain: string[], hashed: string[]}>}
 */
const generate = async () => {
	const plain = [];
	const hashed = [];

	for (let i = 0; i < 8; i++) {
		// biome-ignore lint/security/noSecrets: Crockford Base32 alphabet
		const code = Array.from({ length: 8 }, () => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[crypto.randomInt(32)]).join("");
		plain.push(code);
		hashed.push(await hash(code, true));
	}

	return { plain, hashed };
};

const internalBackupCodes = {
	/**
	 * @param   {number} userId
	 * @returns {Promise<number>}
	 */
	count: async (userId, trx) => await codesOf(userId, trx).resultSize(),

	/**
	 * @param   {number} userId
	 * @returns {Promise<string[]>}
	 */
	create: async (userId, outerTrx) => {
		const { plain, hashed } = await generate();

		await authModel.transaction(outerTrx, async (trx) => {
			await codesOf(userId, trx).delete();
			for (const secret of hashed) {
				await authModel.query(trx).insert({ user_id: userId, type: "backup_code", secret, meta: {} });
			}
		});

		return plain;
	},

	/**
	 * @param   {number} userId
	 * @returns {Promise<void>}
	 */
	delete: async (userId, trx) => {
		await codesOf(userId, trx).delete();
	},

	/**
	 * @param   {number} userId
	 * @param   {string} code
	 * @returns {Promise<boolean>}
	 */
	verify: async (userId, code) => {
		// a used code is deleted: during a database move the delete could be lost and the code valid again
		const release = maintenance.beginWrite();
		try {
			const normalizedCode = code.toUpperCase().replaceAll("O", "0").replace(/[IL]/gu, "1");

			for (const row of await codesOf(userId)) {
				const match = row.secret.startsWith("$2")
					? await bcrypt.compare(normalizedCode, row.secret)
					: await verify(normalizedCode, row.secret);
				// only the request that removes the code counts as used
				if (match) return (await authModel.query().findById(row.id).delete()) === 1;
			}

			return false;
		} finally {
			release();
		}
	},
};

export default internalBackupCodes;
