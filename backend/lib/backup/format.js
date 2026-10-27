import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("NPMPROBK");
const FORMAT_VERSION = 1;
const MAX_HEADER = 64 * 1024;
const TAG = 16;
const SCRYPT = { N: 131072, r: 8, p: 1 };

class BackupError extends Error {
	name = this.constructor.name;
	public = true;
	status = 400;

	constructor(code, message, options) {
		super(message ?? code, options);
		this.code = code;
		this.message_i18n = `backup.error.${code}`;
	}
}

const SCRYPT_MAXMEM = 256 * SCRYPT.N * SCRYPT.r;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const hasBytes = (value, length) => typeof value === "string" && Buffer.from(value, "base64").length === length;

const deriveKey = (header, { passphrase, instanceKey }) => {
	const salt = Buffer.from(header.salt, "base64");
	if (header.kdf === "instance") {
		if (!instanceKey) {
			return Promise.reject(
				new BackupError("wrong-passphrase", "This automatic backup belongs to another instance"),
			);
		}
		return Promise.resolve(Buffer.from(hkdfSync("sha256", instanceKey, salt, "npmpro-backup-auto", 32)));
	}
	if (typeof passphrase !== "string" || passphrase === "") {
		return Promise.reject(new BackupError("wrong-passphrase", "This backup needs its passphrase"));
	}
	return new Promise((resolve, reject) =>
		scrypt(passphrase.normalize("NFC"), salt, 32, { ...SCRYPT, maxmem: SCRYPT_MAXMEM }, (err, key) =>
			err ? reject(err) : resolve(key),
		),
	);
};

const encodeHeader = (header) => {
	const json = Buffer.from(JSON.stringify(header));
	const length = Buffer.alloc(4);
	length.writeUInt32BE(json.length);
	return Buffer.concat([MAGIC, length, json]);
};

/**
 * Writes a backup file: the header, then the gzip tar (encrypted unless mode is "none"). Written to a temporary name
 * and renamed, so a failed write never leaves a half file under the final name.
 */
const writeBackupFile = async ({ source, file, mode, passphrase, instanceKey, summary }) => {
	const header = {
		v: FORMAT_VERSION,
		kdf: { passphrase: "scrypt", none: "none", instance: "instance" }[mode],
		summary,
	};
	if (!header.kdf) throw new Error(`Unknown backup mode ${mode}`);
	if (mode === "passphrase") Object.assign(header, SCRYPT);
	if (mode !== "none") {
		header.salt = randomBytes(16).toString("base64");
		header.iv = randomBytes(12).toString("base64");
	}
	const head = encodeHeader(header);
	const temp = `${file}.part`;
	try {
		const stages = [source];
		let cipher = null;
		if (mode !== "none") {
			const key = await deriveKey(header, { passphrase, instanceKey });
			cipher = createCipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
			cipher.setAAD(head);
			stages.push(cipher);
		}
		// The header goes first and the tag last, inside the same pipeline, so every stream error is handled.
		stages.push(async function* (body) {
			yield head;
			yield* body;
			if (cipher) yield cipher.getAuthTag();
		});
		await pipeline(...stages, createWriteStream(temp, { mode: 0o600 }));
		await rename(temp, file);
	} catch (err) {
		await rm(temp, { force: true });
		throw err;
	}
};

const readHeader = async (file) => {
	const handle = await open(file, "r");
	try {
		const { size } = await handle.stat();
		const start = Buffer.alloc(MAGIC.length + 4);
		await handle.read(start, 0, start.length, 0);
		if (!start.subarray(0, MAGIC.length).equals(MAGIC)) {
			throw new BackupError("not-a-backup", "This is not an NPMpro backup file");
		}
		const length = start.readUInt32BE(MAGIC.length);
		if (length > MAX_HEADER || start.length + length > size) {
			throw new BackupError("not-a-backup", "The backup header is damaged");
		}
		const json = Buffer.alloc(length);
		await handle.read(json, 0, length, start.length);
		let header;
		try {
			header = JSON.parse(json.toString("utf8"));
		} catch {
			throw new BackupError("not-a-backup", "The backup header is damaged");
		}
		if (!Number.isInteger(header?.v) || !["scrypt", "none", "instance"].includes(header.kdf)) {
			throw new BackupError("not-a-backup", "The backup header is damaged");
		}
		if (header.kdf !== "none") {
			const fixedCost = header.kdf !== "scrypt" || ["N", "r", "p"].every((name) => header[name] === SCRYPT[name]);
			if (!(fixedCost && hasBytes(header.salt, SALT_BYTES) && hasBytes(header.iv, IV_BYTES))) {
				throw new BackupError("not-a-backup", "The backup header is damaged");
			}
		}
		return { header, headBytes: Buffer.concat([start, json]), dataStart: start.length + length, size };
	} finally {
		await handle.close();
	}
};

/**
 * @returns {Promise<import("node:stream").Readable>}  the gzip tar; for an encrypted file the stream fails at its end
 *                                                     when the file was changed or the key is wrong
 */
const openBackupFile = async ({ file, passphrase, instanceKey }) => {
	const { header, headBytes, dataStart, size } = await readHeader(file);
	if (header.kdf === "none") return createReadStream(file, { start: dataStart });
	if (size - dataStart < TAG) throw new BackupError("wrong-passphrase", "Wrong passphrase or damaged backup file");
	const key = await deriveKey(header, { passphrase, instanceKey });
	const tag = Buffer.alloc(TAG);
	const handle = await open(file, "r");
	try {
		await handle.read(tag, 0, TAG, size - TAG);
	} finally {
		await handle.close();
	}
	const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
	decipher.setAAD(headBytes);
	decipher.setAuthTag(tag);
	const out = new PassThrough();
	const input = createReadStream(file, { start: dataStart, end: size - TAG - 1 });
	// No pipeline() here: it would destroy `out` with the raw error before it could be replaced by a BackupError.
	const fail = (err) => {
		input.destroy();
		decipher.destroy();
		out.destroy(new BackupError("wrong-passphrase", "Wrong passphrase or damaged backup file", { cause: err }));
	};
	out.on("close", () => {
		input.destroy();
		decipher.destroy();
	});
	input.on("error", fail);
	decipher.on("error", fail);
	input.pipe(decipher).pipe(out);
	return out;
};

export { BackupError, FORMAT_VERSION, openBackupFile, readHeader, writeBackupFile };
