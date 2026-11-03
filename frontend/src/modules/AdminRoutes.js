// The pages that moved into Settings (spec: the Administration group) and their old addresses. Pure, so node --test
// checks it; Router.jsx redirects with it.

const MOVED = Object.freeze({ "/users": "/settings/users", "/audit-log": "/settings/audit-log" });

export function adminRedirect(pathname, search = "") {
	const target = MOVED[pathname];
	return target ? `${target}${search}` : null;
}
