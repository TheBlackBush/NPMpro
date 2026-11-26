/**
 * The pure parts of the forgot and reset password pages
 */

const FORGOT_PATH = "/forgot-password";
const RESET_PATH = "/reset-password";

const TRAILING_SLASHES = /\/+$/u;
const LEADING_HASH = /^#/u;

/**
 * Which of the two pages that need no session an address is: "forgot", "reset" or null (a trailing slash is allowed)
 *
 * @param   {string} pathname
 * @returns {"forgot"|"reset"|null}
 */
export const publicPageOf = (pathname) => {
	const path = pathname.length > 1 ? pathname.replace(TRAILING_SLASHES, "") : pathname;
	if (path === FORGOT_PATH) return "forgot";
	if (path === RESET_PATH) return "reset";
	return null;
};

/**
 * The reset token of an address fragment ("#token=abc" or "#x=1&token=abc"); "" when there is none. The token travels
 * in the fragment so that it is never sent to a server in a request line or logged.
 *
 * @param   {string} hash  location.hash
 * @returns {string}
 */
export const tokenFromHash = (hash) => {
	const fragment = String(hash ?? "").replace(LEADING_HASH, "");
	return new URLSearchParams(fragment).get("token") ?? "";
};

/**
 * The token of the page: the fragment first, then the one kept in the history entry (the page removes the fragment
 * from the address, and a reload, such as the language switch, comes back with the entry's state), else "".
 *
 * @param   {string} hash   location.hash
 * @param   {unknown} state  history.state
 * @returns {string}
 */
export const resetTokenOf = (hash, state) => {
	const fromHash = tokenFromHash(hash);
	if (fromHash !== "") return fromHash;
	const kept = state?.resetToken;
	return typeof kept === "string" ? kept : "";
};
