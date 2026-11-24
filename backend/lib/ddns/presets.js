// The update-URL presets (Namecheap, No-IP, Dynu): zoneless providers with no DNS credential. Their account details
// are sealed in the record's `secret` column, as the custom provider's URL is. A leaf: no imports.

/** The sealed fields of each preset: the ones typed in the record window */
const PRESET_FIELDS = Object.freeze({
	namecheap: Object.freeze(["domain", "password"]),
	noip: Object.freeze(["username", "password"]),
	dynu: Object.freeze(["username", "password"]),
});

const isPreset = (id) => typeof id === "string" && Object.hasOwn(PRESET_FIELDS, id);

/**
 * The values of a preset's sealed secret that must never be shown (scrubbed from every message). scrubSecrets skips a
 * value under 4 characters, so a short user name (Dynu allows 3) is not scrubbed. That is safe today because the user
 * name only travels in the Basic auth header: no preset puts it into a URL or into a message of its own, and the
 * providers do not echo it back. Keep it that way, or revisit the minimum.
 */
const presetSecrets = (fields) =>
	[fields?.password, fields?.username].filter((value) => typeof value === "string" && value !== "");

export { isPreset, PRESET_FIELDS, presetSecrets };
