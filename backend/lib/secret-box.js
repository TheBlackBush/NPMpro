import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const algorithm = "aes-256-gcm";
const ivLength = 12;
const tagLength = 16;

class SecretBoxError extends Error {
	name = this.constructor.name;
	public = true;
	status = 400;
}

/**
 * Encrypts JSON values with AES-256-GCM. The key file is created on first use.
 *
 * @param   {String}  keyFile
 * @returns {{encrypt: (obj: Object) => String, decrypt: (text: String) => Object}}
 */
const createSecretBox = (keyFile) => {
	let key = null;

	const loadKey = (create) => {
		if (key) return key;
		if (!existsSync(keyFile)) {
			if (!create) throw new SecretBoxError(`Encryption key ${keyFile} is missing`);
			mkdirSync(path.dirname(keyFile), { recursive: true });
			writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: "wx" });
		}
		try {
			key = readFileSync(keyFile);
		} catch (err) {
			throw new SecretBoxError(`Encryption key ${keyFile} cannot be read`, { cause: err });
		}
		if (key.length !== 32) throw new SecretBoxError(`Encryption key ${keyFile} is invalid`);
		return key;
	};

	return {
		encrypt: (obj) => {
			const iv = randomBytes(ivLength);
			const cipher = createCipheriv(algorithm, loadKey(true), iv, { authTagLength: tagLength });
			const data = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
			return ["v1", ...[iv, cipher.getAuthTag(), data].map((part) => part.toString("base64"))].join(":");
		},
		decrypt: (text) => {
			const parts = String(text).split(":");
			if (parts.length !== 4 || parts[0] !== "v1") throw new SecretBoxError("Unknown encrypted value format");
			const [iv, tag, data] = parts.slice(1).map((part) => Buffer.from(part, "base64"));
			if (iv.length !== ivLength || tag.length !== tagLength) {
				throw new SecretBoxError("Unknown encrypted value format");
			}
			const currentKey = loadKey(false);
			let plain;
			try {
				const decipher = createDecipheriv(algorithm, currentKey, iv, { authTagLength: tagLength });
				decipher.setAuthTag(tag);
				plain = Buffer.concat([decipher.update(data), decipher.final()]);
			} catch (err) {
				throw new SecretBoxError("Encrypted value cannot be decrypted, it was saved with another key", {
					cause: err,
				});
			}
			try {
				return JSON.parse(plain.toString("utf8"));
			} catch (err) {
				throw new SecretBoxError("Encrypted value is corrupt", { cause: err });
			}
		},
	};
};

const defaultSecretBox = createSecretBox(process.env.NPMPRO_SECRET_KEY_FILE ?? "/data/npmplus/dns-credentials.key");

export { createSecretBox, defaultSecretBox, SecretBoxError };
