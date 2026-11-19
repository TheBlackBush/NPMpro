import { isAdmin, PERMISSION_SECTIONS, permissionChanges } from "./Permissions.js";

export const LEVELS = ["hidden", "view", "manage"];
export const TOKEN_PLACEHOLDER = "YOUR_TOKEN";

// the characters of an NPMpro token (prefix, id part, base64url secret); anything else is never put into a header or
// a command line
const TOKEN_TEXT = /^[\w-]+$/u;

/**
 * The Authorization header line with the token, or with the placeholder when there is none or it looks odd
 */
export const authHeader = (token = TOKEN_PLACEHOLDER) =>
	`Authorization: Bearer ${typeof token === "string" && TOKEN_TEXT.test(token) ? token : TOKEN_PLACEHOLDER}`;

export const EXPIRY_CHOICES = ["30", "90", "365", "date", "never"];
export const DEFAULT_EXPIRY = "90";

const DAY = 86_400_000;

/**
 * The most a token of this user can have: an administrator everything, a user its own levels
 */
export const ownerCaps = (user) => {
	const admin = isAdmin(user?.roles);
	const caps = { visibility: admin || user?.permissions?.visibility === "all" ? "all" : "user" };
	for (const section of PERMISSION_SECTIONS) {
		caps[section] = admin ? "manage" : (user?.permissions?.[section] ?? "hidden");
	}
	return caps;
};

export const levelAllowed = (level, cap) => LEVELS.indexOf(level) <= LEVELS.indexOf(cap);

const levelIndex = (level) => Math.max(0, LEVELS.indexOf(level));

/** The lower of a level and its cap; an unknown value counts as hidden */
export const capLevel = (level, cap) => LEVELS[Math.min(levelIndex(level), levelIndex(cap))];

/**
 * Drops the changes above the owner's level, e.g. an automatic certificates view the owner does not have
 */
export const clampChanges = (changes, caps) =>
	Object.fromEntries(Object.entries(changes).filter(([section, level]) => levelAllowed(level, caps[section])));

/**
 * "Set all": every section at the level, capped by the owner's levels, then what the sections need (access lists for
 * proxy hosts, certificates for hosts and streams) where the caps allow it, as a single click does
 */
export const setAllLevels = (level, caps) => {
	const values = Object.fromEntries(PERMISSION_SECTIONS.map((section) => [section, capLevel(level, caps[section])]));
	for (const section of PERMISSION_SECTIONS) {
		Object.assign(values, clampChanges(permissionChanges(values, section, values[section]), caps));
	}
	return values;
};

/**
 * The day after now as YYYY-MM-DD in local time, the earliest expiry date
 */
export const tomorrowOf = (now) => {
	const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
	return [
		next.getFullYear(),
		String(next.getMonth() + 1).padStart(2, "0"),
		String(next.getDate()).padStart(2, "0"),
	].join("-");
};

export const expiresOnOf = (choice, date, now) => {
	if (choice === "never") return null;
	if (choice === "date") {
		const [year, month, day] = date.split("-").map(Number);
		return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
	}
	return new Date(now.getTime() + Number(choice) * DAY).toISOString();
};

export const tokenPayload = (values, now) => ({
	name: values.name.trim(),
	expiresOn: expiresOnOf(values.expiry, values.expiryDate, now),
	visibility: values.visibility,
	permissions: Object.fromEntries(PERMISSION_SECTIONS.map((section) => [section, values[section]])),
	admin: values.admin,
	allowDelete: values.allowDelete,
});

export const newTokenValues = () => ({
	name: "",
	expiry: DEFAULT_EXPIRY,
	expiryDate: "",
	visibility: "user",
	...Object.fromEntries(PERMISSION_SECTIONS.map((section) => [section, "hidden"])),
	admin: false,
	allowDelete: false,
});

/**
 * The summary of a token's six section levels as the parts of one line: [["all-manage"]] when every section is
 * Manage, [["all-view"]] when every section is View Only, else [key, count] for manage, view and hidden in that order
 * with the zero counts left out (the cell turns each into text). A level that is missing counts as hidden.
 */
export const permissionSummary = (permissions) => {
	const counts = { manage: 0, view: 0, hidden: 0 };
	for (const section of PERMISSION_SECTIONS) {
		const level = permissions?.[section];
		counts[level === "manage" || level === "view" ? level : "hidden"] += 1;
	}
	if (counts.manage === PERMISSION_SECTIONS.length) return [["all-manage"]];
	if (counts.view === PERMISSION_SECTIONS.length) return [["all-view"]];
	return Object.entries(counts).filter(([, count]) => count > 0);
};

export const tokenState = (token, now) =>
	token.expired || (token.expiresOn && new Date(token.expiresOn).getTime() <= now.getTime()) ? "expired" : "active";

/** The marks a token shows beside or under its name, in this order */
export const tokenMarks = (token, now) =>
	[
		token.admin ? "admin" : null,
		token.allowDelete ? "allowDelete" : null,
		tokenState(token, now) === "expired" ? "expired" : null,
	].filter(Boolean);
