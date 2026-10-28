/**
 * Which settings section the phone select shows for a path: the first segment after /settings
 * (nested paths count for their section); an unknown or missing section falls back to the first one.
 *
 * @param {string} pathname
 * @param {string[]} ids
 * @returns {string}
 */
const selectedSectionId = (pathname, ids) => {
	const [, root, section] = String(pathname ?? "").split("/");
	return root === "settings" && ids.includes(section) ? section : ids[0];
};

export { selectedSectionId };
