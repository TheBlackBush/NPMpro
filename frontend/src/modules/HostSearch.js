/**
 * The text of a host's labels for the list search (listType searchText): the description, then the tags. Pure, so
 * node --test checks it.
 *
 * @param   {{ npmproDescription?: string, npmproTags?: string[] }|undefined} item
 * @returns {string}
 */
export function labelSearchText(item) {
	return [item?.npmproDescription ?? "", ...(item?.npmproTags ?? [])].join(" ");
}
