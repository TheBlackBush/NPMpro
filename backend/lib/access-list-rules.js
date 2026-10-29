import errs from "./error.js";

const isAll = (address) => String(address).trim().toLowerCase() === "all";

/**
 * The access rules with an address; rows without one are left out (the form sends them empty)
 *
 * @param   {Array<{ address?: string, directive: string }>}  [clients]
 * @returns {Array}
 */
const clientsWithAddress = (clients = []) => clients.filter(({ address }) => String(address ?? "").trim() !== "");

/**
 * The rules nginx can not check for an access list: each username once (htpasswd matches the first line only), and
 * an "all" rule only as the last rule (nginx stops at the first match, so an earlier "allow all" opens the list).
 * Only checks what the request sends: items or clients left out keep the saved ones.
 *
 * @param {Object} data  { items, clients } of a create or update request
 */
const assertAccessListRules = ({ items, clients } = {}) => {
	if (items && new Set(items.map(({ username }) => username)).size !== items.length) {
		throw new errs.ValidationError("Access list usernames need to be unique", "error.access.duplicate-usernames");
	}
	if (clients) {
		const rules = clientsWithAddress(clients);
		if (rules.some(({ address }, index) => isAll(address) && index !== rules.length - 1)) {
			throw new errs.ValidationError(
				"An all access rule can only be the last rule",
				"error.access.all-rule-last",
			);
		}
	}
};

export { assertAccessListRules, clientsWithAddress };
