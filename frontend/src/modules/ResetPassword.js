/**
 * The pure parts of the forgot and reset password pages
 */

// the same rules as the password of the user window: 8 to 255 characters, not trimmed
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 255;

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
 * Checks a new password and its repeat: the first problem, as the field it belongs to and a reason ("required", "short",
 * "long" or "mismatch"), or null. A mismatch shows only once the password itself is fine and the repeat is filled in.
 *
 * @param   {string} password
 * @param   {string} repeat
 * @returns {{ field: "new"|"confirm", reason: string }|null}
 */
export const passwordPairValidate = (password, repeat) => {
	const first = String(password ?? "");
	if (first.length === 0) return { field: "new", reason: "required" };
	if (first.length < PASSWORD_MIN) return { field: "new", reason: "short" };
	if (first.length > PASSWORD_MAX) return { field: "new", reason: "long" };
	if (String(repeat ?? "") !== first) return { field: "confirm", reason: "mismatch" };
	return null;
};

export { PASSWORD_MAX, PASSWORD_MIN };
