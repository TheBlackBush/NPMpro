import crypto from "node:crypto";
import nodeFs from "node:fs/promises";
import { gravatar as logger } from "../logger.js";
import pjson from "../package.json" with { type: "json" };
import { gravatarOn } from "./runtime-config.js";

const AVATAR_EXTS = ["png", "jpg", "gif", "webp"];
const DEFAULT_AVATAR = "/images/default-avatar.jpg";
const GRAVATAR_DIR = "/data/gravatar";

/**
 * The image type of an avatar file from its first bytes, null when it is not png, jpg, gif or webp
 *
 * @param   {Buffer}  b
 * @returns {string|null}
 */
const avatarExt = (b) => {
	if (!b || b.length < 12) return null;
	if (b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png";
	if (b.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "jpg";
	if (b.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
	if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") {
		return "webp";
	}
	return null;
};

/**
 * Removes the user's fetched Gravatar picture and fetches it again; the default avatar when Gravatar is off
 * (advanced.gravatar, read per call) or the fetch fails
 *
 * @param   {number}  id
 * @param   {string}  email
 * @param   {string}  name
 * @param   {Object}  [deps]
 * @param   {Function} [deps.enabled]  () => boolean
 * @param   {Function} [deps.fetch]
 * @param   {Object}   [deps.fs]       node:fs/promises compatible
 * @param   {string}   [deps.dir]
 * @param   {Object}   [deps.log]
 * @returns {Promise<string>}  the avatar URL
 */
const fetchGravatar = async (
	id,
	email,
	name,
	{ enabled = gravatarOn, fetch = globalThis.fetch, fs = nodeFs, dir = GRAVATAR_DIR, log = logger } = {},
) => {
	for (const e of AVATAR_EXTS) await fs.rm(`${dir}/${id}.${e}`, { force: true });
	if (!enabled()) return DEFAULT_AVATAR;
	try {
		const initials = name
			.split(" ")
			.map((n) => n[0])
			.join("");
		const response = await fetch(
			`https://www.gravatar.com/avatar/${crypto.hash("sha256", email)}?s=64&default=initials&name=${encodeURIComponent(initials)}`,
			{ headers: { "User-Agent": `NPMpro/${pjson.version}` } },
		);

		if (!response.ok) throw new Error(`Status code: ${response.status}`);

		const buffer = Buffer.from(await response.arrayBuffer());
		const ext = avatarExt(buffer);
		if (!ext) throw new Error("Unsupported image format");

		await fs.writeFile(`${dir}/${id}.${ext}`, buffer);

		return `/images/gravatar/${id}.${ext}?v=${Date.now()}`;
	} catch (err) {
		log.error(`Error downloading gravatar: ${err.message}`);
		return DEFAULT_AVATAR;
	}
};

export { AVATAR_EXTS, avatarExt, DEFAULT_AVATAR, fetchGravatar };
