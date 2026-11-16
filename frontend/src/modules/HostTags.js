/**
 * The tags of the hosts (npmproTags): the rule of a tag (the backend's schema/common.json npmpro_tags), the
 * suggestions of the windows, the filter of the lists. Pure, so node --test checks them.
 */

// the backend's limits
export const TAG_MAX_LENGTH = 32;
export const TAGS_MAX = 10;

const TAG = /^[\p{L}\p{M}\p{N}._-](?:[\p{L}\p{M}\p{N} ._-]*[\p{L}\p{M}\p{N}._-])?$/u;

const keyOf = (tag) =>
	String(tag ?? "")
		.trim()
		.toLowerCase();

/** Whether a typed tag is valid once trimmed: 1 to 32 code points of the allowed characters */
export function isValidTag(input) {
	const tag = String(input ?? "").trim();
	return tag !== "" && [...tag].length <= TAG_MAX_LENGTH && TAG.test(tag);
}

export const sameTag = (a, b) => keyOf(a) === keyOf(b);

// the list without later case twins, first spelling kept
const unique = (tags) => {
	const seen = new Set();
	return tags.filter((tag) => {
		const key = keyOf(tag);
		if (key === "" || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

/**
 * Every tag used in the lists, once (first spelling), sorted for the reader's language
 *
 * @param   {...(Array<{ npmproTags?: string[] }>|undefined)} lists
 * @returns {string[]}
 */
export function tagNames(...lists) {
	const all = lists.flatMap((list) => (list ?? []).flatMap((item) => item?.npmproTags ?? []));
	return unique(all).sort((a, b) => a.localeCompare(b));
}

/** The suggestions a tag field offers: the names it does not hold, in any case */
export function tagOptions(names, values) {
	return names
		.filter((name) => !(values ?? []).some((value) => sameTag(value, name)))
		.map((name) => ({ label: name, value: name }));
}

/** Whether a host has every picked tag, in any case */
export function hasAllTags(hostTags, picked) {
	return (picked ?? []).every((tag) => (hostTags ?? []).some((own) => sameTag(own, tag)));
}

/** The wanted tags (from the URL) as their known spelling, once, in order; unknown ones dropped */
export function canonicalTags(wanted, known) {
	return unique((wanted ?? []).map((tag) => (known ?? []).find((name) => sameTag(name, tag))).filter(Boolean));
}

export const addTag = (list, tag) => (list.some((own) => sameTag(own, tag)) ? list : [...list, tag]);
export const removeTag = (list, tag) => list.filter((own) => !sameTag(own, tag));

/**
 * The error of a host's tags for the window's validator: too many, or the first invalid one by name
 *
 * @param   {Object}   rules  createValidations()
 * @param   {string[]} tags
 * @returns {*}  undefined when they are fine
 */
export function tagsError(rules, tags) {
	const list = tags ?? [];
	if (list.length > TAGS_MAX) return rules.message("error.tags-too-many", { max: TAGS_MAX });
	const bad = list.find((tag) => !isValidTag(tag));
	return bad === undefined ? undefined : rules.message("error.tag-invalid", { tag: bad });
}

/**
 * Why the tag field offers nothing for a typed text: no tags yet, too many already, or an invalid tag
 *
 * @param   {string} input
 * @param   {number} count  the tags the field holds
 * @returns {{ id: string, values: Object }}
 */
export function tagInputMessage(input, count) {
	const tag = String(input ?? "").trim();
	if (tag === "") return { id: "host.tags.none", values: {} };
	if (count >= TAGS_MAX) return { id: "error.tags-too-many", values: { max: TAGS_MAX } };
	return { id: "error.tag-invalid", values: { tag } };
}
