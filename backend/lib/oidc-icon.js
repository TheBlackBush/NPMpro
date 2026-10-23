import { readFile, rm, writeFile } from "node:fs/promises";
import pjson from "../package.json" with { type: "json" };
import errs from "./error.js";

/**
 * OIDC login button icon: type detection, SVG checks, URL download and the stored file
 */

const ICON_MAX_BYTES = 256 * 1024;
const ICON_MIME = {
	png: "image/png",
	jpg: "image/jpeg",
	webp: "image/webp",
	svg: "image/svg+xml",
};
const ICON_DIR = "/data/npmpro";
const DOWNLOAD_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const PNG_MAGIC = Buffer.from("89504e470d0a1a0a", "hex");
const JPEG_MAGIC = Buffer.from("ffd8ff", "hex");
const SVG_PREAMBLE = /^\s*(?:<\?xml\s[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*>)/iu;
const SVG_START = /^\s*<svg[\s>/]/u;
const SVG_UNSAFE = [
	// script elements, also with a namespace prefix
	/<(?:[\w.-]+:)?script[\s>/]/iu,
	// event handler attributes after any separator
	/[\s/"']on[a-z]+\s*=/iu,
	// numeric character references
	/&#/u,
	// named entity references other than the five predefined by XML
	/&(?!(?:amp|lt|gt|quot|apos);)[A-Za-z_][\w.-]*;/u,
	/<!ENTITY/iu,
	/<(?:[\w.-]+:)?foreignObject/iu,
	// animations that set an event handler attribute
	/<(?:[\w.-]+:)?(?:set|animate|animateTransform|animateMotion)\b[^>]*\battributeName\s*=\s*["']?\s*on/iu,
	// processing instructions other than the xml declaration (xml-stylesheet and others)
	/<\?(?!xml\s)/iu,
];
const JS_URL = /javascript:/iu;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are stripped on purpose
const STRIPPED = /[\s\u0000-\u001f]/gu;

const tooLarge = () => new errs.ValidationError("Icon is too large (max 256 KB)");

/**
 * SVG text when the buffer is valid UTF-8 starting with <svg after an optional
 * XML prolog, comments and a doctype without an internal subset
 *
 * @param   {Buffer}  buffer
 * @returns {string|null}
 */
const svgText = (buffer) => {
	let text;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
	} catch {
		return null;
	}
	let rest = text;
	let match = SVG_PREAMBLE.exec(rest);
	while (match) {
		rest = rest.slice(match[0].length);
		match = SVG_PREAMBLE.exec(rest);
	}
	return SVG_START.test(rest) ? text : null;
};

/**
 * @param   {Buffer}  buffer
 * @returns {"png"|"jpg"|"webp"|"svg"|null}
 */
const detectIconType = (buffer) => {
	if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
	if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC)) return "png";
	if (buffer.length >= 3 && buffer.subarray(0, 3).equals(JPEG_MAGIC)) return "jpg";
	if (
		buffer.length >= 12 &&
		buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
		buffer.subarray(8, 12).toString("latin1") === "WEBP"
	) {
		return "webp";
	}
	return svgText(buffer) === null ? null : "svg";
};

/**
 * @param   {string}  text
 * @returns {boolean}  false for scripts, event handlers, javascript: URLs, entity and character
 *                     references (except the five XML ones), foreignObject, handler animations
 *                     and processing instructions other than the xml declaration
 */
const svgIsSafe = (text) =>
	!(SVG_UNSAFE.some((pattern) => pattern.test(text)) || JS_URL.test(text.replace(STRIPPED, "")));

/**
 * @param   {Buffer}  buffer
 * @returns {"png"|"jpg"|"webp"|"svg"}
 * @throws  {errs.ValidationError}
 */
const checkIcon = (buffer) => {
	if (Buffer.isBuffer(buffer) && buffer.length > ICON_MAX_BYTES) throw tooLarge();
	const ext = detectIconType(buffer);
	if (!ext) throw new errs.ValidationError("Unsupported icon type, use PNG, JPEG, WebP or SVG");
	if (ext === "svg" && !svgIsSafe(buffer.toString("utf8"))) {
		throw new errs.ValidationError("SVG with scripts or event handlers is not allowed");
	}
	return ext;
};

const httpUrl = (value, base) => {
	let url;
	try {
		url = new URL(value, base);
	} catch {
		url = null;
	}
	if (!url || !["http:", "https:"].includes(url.protocol)) {
		throw new errs.ValidationError("Icon URL must use http or https");
	}
	return url;
};

const readLimited = async (response) => {
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > ICON_MAX_BYTES) {
		await response.body?.cancel().catch(() => {});
		throw tooLarge();
	}
	if (!response.body) return Buffer.alloc(0);
	const reader = response.body.getReader();
	const chunks = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.length;
		if (size > ICON_MAX_BYTES) {
			await reader.cancel().catch(() => {});
			throw tooLarge();
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks, size);
};

/**
 * Downloads an icon over http or https (private addresses allowed). Redirects are
 * followed manually, at most 3, each one re-checked. The body is cut off above 256 KB.
 * Response bodies never end up in error messages.
 *
 * @param   {string}  value      the URL
 * @param   {number}  [timeout]  total timeout in ms (default 10 s)
 * @returns {Promise<Buffer>}
 * @throws  {errs.ValidationError}
 */
const downloadIcon = async (value, timeout = DOWNLOAD_TIMEOUT_MS) => {
	let url = httpUrl(value);
	const signal = AbortSignal.timeout(timeout);
	try {
		for (let redirects = 0; ; redirects++) {
			const response = await fetch(url, {
				redirect: "manual",
				signal,
				headers: { "User-Agent": `NPMpro/${pjson.version}`, Accept: Object.values(ICON_MIME).join(", ") },
			});
			if (REDIRECT_STATUSES.has(response.status) && response.headers.has("location")) {
				await response.body?.cancel().catch(() => {});
				if (redirects >= MAX_REDIRECTS)
					throw new errs.ValidationError("Icon download failed: too many redirects");
				url = httpUrl(response.headers.get("location"), url);
				continue;
			}
			if (response.status < 200 || response.status > 299) {
				await response.body?.cancel().catch(() => {});
				throw new errs.ValidationError(`Icon download failed: HTTP ${response.status}`);
			}
			return await readLimited(response);
		}
	} catch (err) {
		if (err instanceof errs.ValidationError) throw err;
		if (signal.aborted) throw new errs.ValidationError("Icon download timed out");
		throw new errs.ValidationError("Icon download failed: could not connect", undefined, { cause: err });
	}
};

/**
 * Fixed path of the stored icon, the extension only ever comes from ICON_MIME
 *
 * @param   {string}  ext
 * @returns {string|null}
 */
const iconPath = (ext) => (Object.hasOwn(ICON_MIME, ext) ? `${ICON_DIR}/oidc-icon.${ext}` : null);

/**
 * Removes the stored icon files
 *
 * @param   {string}  [keep]  extension to keep (the file the row now points at)
 */
const removeIconFiles = async (keep) => {
	for (const ext of Object.keys(ICON_MIME)) {
		if (ext !== keep) await rm(iconPath(ext), { force: true });
	}
};

/**
 * Writes the icon file; the caller removes the other extensions once the row is saved
 *
 * @param   {Buffer}  buffer  already checked with checkIcon
 * @param   {string}  ext     from checkIcon
 */
const writeIconFile = async (buffer, ext) => {
	const path = iconPath(ext);
	if (!path) throw new errs.ValidationError("Unsupported icon type, use PNG, JPEG, WebP or SVG");
	await writeFile(path, buffer);
};

/**
 * @param   {string}  ext
 * @returns {Promise<Buffer|null>}  null when there is no such file
 */
const readIconFile = async (ext) => {
	const path = iconPath(ext);
	if (!path) return null;
	try {
		return await readFile(path);
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw err;
	}
};

export {
	checkIcon,
	detectIconType,
	downloadIcon,
	ICON_MAX_BYTES,
	ICON_MIME,
	iconPath,
	readIconFile,
	removeIconFiles,
	svgIsSafe,
	writeIconFile,
};
