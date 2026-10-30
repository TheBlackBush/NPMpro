export const ADMIN = "admin";
export const PROXY_HOSTS = "proxyHosts";
export const REDIRECTION_HOSTS = "redirectionHosts";
export const DEAD_HOSTS = "deadHosts";
export const STREAMS = "streams";
export const CERTIFICATES = "certificates";
export const ACCESS_LISTS = "accessLists";

export const MANAGE = "manage";
export const VIEW = "view";
const HIDDEN = "hidden";

const hasPermission = (section, perm, userPerms, roles) => {
	if (isAdmin(roles)) return true;
	if (!userPerms) return false;
	const acceptable = [MANAGE, perm];
	// @ts-expect-error 7053
	const v = typeof userPerms[section] !== "undefined" ? userPerms[section] : HIDDEN;
	return acceptable.indexOf(v) !== -1;
};

const isAdmin = (roles) => roles?.includes("admin");

// the sections of a user's permissions, in the order the windows show them
const PERMISSION_SECTIONS = [PROXY_HOSTS, REDIRECTION_HOSTS, DEAD_HOSTS, STREAMS, ACCESS_LISTS, CERTIFICATES];
// the sections whose items use certificates
const USES_CERTIFICATES = [PROXY_HOSTS, REDIRECTION_HOSTS, DEAD_HOSTS, STREAMS];

/**
 * The other permissions a choice turns on: proxy hosts need the access lists, hosts and streams need the
 * certificates (at least view)
 *
 * @param   {Object} values  section -> "manage" | "view" | "hidden" (one user's permissions)
 * @param   {string} section  the section chosen for
 * @param   {string} perm     the choice
 * @returns {Object} section -> permission
 */
const permissionChanges = (values, section, perm) => {
	const changes = {};
	if (perm === HIDDEN) return changes;
	if (section === PROXY_HOSTS && values[ACCESS_LISTS] === HIDDEN) changes[ACCESS_LISTS] = VIEW;
	if (USES_CERTIFICATES.includes(section) && values[CERTIFICATES] === HIDDEN) changes[CERTIFICATES] = VIEW;
	return changes;
};

/**
 * Whether "hidden" is ruled out for a section by the others (the access lists while proxy hosts are shown, the
 * certificates while any host or stream section is shown)
 *
 * @param   {Object} values
 * @param   {string} section
 * @returns {boolean}
 */
const hiddenRuledOut = (values, section) => {
	if (section === ACCESS_LISTS) return values[PROXY_HOSTS] !== HIDDEN;
	if (section === CERTIFICATES) return USES_CERTIFICATES.some((key) => values[key] !== HIDDEN);
	return false;
};

export { hasPermission, hiddenRuledOut, isAdmin, PERMISSION_SECTIONS, permissionChanges };
