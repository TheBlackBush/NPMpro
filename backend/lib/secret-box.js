import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const algorithm = "aes-256-gcm";

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
		key = readFileSync(keyFile);
		if (key.length !== 32) throw new SecretBoxError(`Encryption key ${keyFile} is invalid`);
		return key;
	};

	return {
		encrypt: (obj) => {
			const iv = randomBytes(12);
			const cipher = createCipheriv(algorithm, loadKey(true), iv);
			const data = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
			return ["v1", ...[iv, cipher.getAuthTag(), data].map((part) => part.toString("base64"))].join(":");
		},
		decrypt: (text) => {
			const parts = String(text).split(":");
			if (parts.length !== 4 || parts[0] !== "v1") throw new SecretBoxError("Unknown encrypted value format");
			try {
				const [, iv, tag, data] = parts.map((part) => Buffer.from(part, "base64"));
				const decipher = createDecipheriv(algorithm, loadKey(false), iv);
				decipher.setAuthTag(tag);
				return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"));
			} catch (err) {
				if (err instanceof SecretBoxError) throw err;
				throw new SecretBoxError("Encrypted value cannot be decrypted, it was saved with another key", {
					cause: err,
				});
			}
		},
	};
};

const defaultSecretBox = createSecretBox(process.env.NPMPRO_SECRET_KEY_FILE ?? "/data/npmplus/dns-credentials.key");

export { createSecretBox, defaultSecretBox, SecretBoxError };
