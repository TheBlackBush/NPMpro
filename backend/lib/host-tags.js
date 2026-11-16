/**
 * Tags of a host, the rule the schema (common.json npmpro_tags) leaves out: two tags that differ only in case are one
 * tag, the first spelling is kept, in the order sent. The validator has trimmed them.
 *
 * @param   {string[]} tags
 * @returns {string[]}
 */
const uniqueTags = (tags) => {
	const seen = new Set();
	return tags.filter((tag) => {
		const key = tag.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

export { uniqueTags };
