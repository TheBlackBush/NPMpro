/**
 * The groups of the host windows' Group field (npmproDirectory): the names already used by any host type, and which
 * typed names the field offers to create. Pure, so node --test checks them.
 */

// the backend's limit (schema/common.json npmpro_directory)
export const GROUP_MAX_LENGTH = 255;

/**
 * Every group name used in the lists, once, sorted for the reader's language; hosts without a group add nothing
 *
 * @param   {...(Array<{ npmproDirectory?: string }>|undefined)} lists  the hosts of each host type (undefined while
 *                                                                     loading, or for a type the user cannot view)
 * @returns {string[]}
 */
export function groupNames(...lists) {
	const names = new Set(lists.flatMap((list) => (list ?? []).map((item) => item?.npmproDirectory).filter(Boolean)));
	return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * The option of a group name for react-select; no option for no group
 *
 * @param   {string} name
 * @returns {{ label: string, value: string }|null}
 */
export function groupOption(name) {
	return name ? { label: name, value: name } : null;
}

/**
 * Whether a typed name is offered as a new group: not empty, within the backend's limit, and not a group that
 * already exists in another case (that one is listed instead)
 *
 * @param   {string}   input
 * @param   {string[]} names  groupNames()
 * @returns {boolean}
 */
export function isNewGroupName(input, names) {
	const name = String(input ?? "").trim();
	if (name === "" || name.length > GROUP_MAX_LENGTH) return false;
	return !names.some((existing) => existing.toLowerCase() === name.toLowerCase());
}
