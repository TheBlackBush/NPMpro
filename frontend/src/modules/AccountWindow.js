// The Account window of the user menu: its parts, where it starts, and what the parts tell the frame (unsaved
// changes, a step only Done ends, a request running). Pure, so node --test checks the rules without a DOM.

/**
 * The parts in side list order: the label key and where the window starts when it opens on the part (its first
 * field, or its heading: MFA and API tokens have no field to start in, and their first button can be destructive)
 */
export const ACCOUNT_PARTS = [
	{ id: "profile", labelId: "account.profile", start: "field" },
	{ id: "password", labelId: "password", start: "field" },
	{ id: "mfa", labelId: "mfa.title", start: "heading" },
	{ id: "api-tokens", labelId: "api-tokens.title", start: "heading" },
];

/**
 * The parts of another user's window (an administrator, Settings, Users, Edit; D36): Profile with the Administrator
 * and Disabled switches, and Sign-in, whose buttons are destructive (it starts on its heading)
 */
export const USER_PARTS = [
	{ id: "profile", labelId: "account.profile", start: "field" },
	{ id: "sign-in", labelId: "account.sign-in", start: "heading" },
];

/** The parts of the own window (self) or of another user's window */
export const partsFor = (self) => (self ? ACCOUNT_PARTS : USER_PARTS);

/**
 * Whether a window for userId is the signed-in user's own: "me" always is, a user id is when it equals the signed-in
 * user's id (an administrator's Edit on the own row of a list that loaded before /users/me). null while the signed-in
 * user's id is not known yet: the window then waits (a loading body) before it chooses its parts, so the own account
 * never gets the Administrator and Disabled switches.
 *
 * @param {"me"|number|string} userId
 * @param {number} [meId]  the signed-in user's id, undefined while /users/me loads
 * @returns {boolean|null}
 */
export function isOwnUser(userId, meId) {
	if (userId === "me") return true;
	if (meId === undefined || meId === null) return null;
	return Number(userId) === meId;
}

/** A list row's user by id, or null when a refetch removed it (deleted in another tab while its menu was open) */
export const rowUser = (users, id) => users?.find((user) => user.id === id) ?? null;

/** The part a request names when the window has it, Profile for anything else */
export const partOf = (requested, parts = ACCOUNT_PARTS) =>
	parts.some((part) => part.id === requested) ? requested : "profile";

/**
 * Whether the window starts on the part's heading instead of its first field: MFA, API tokens and Sign-in, and every
 * part on a phone (a focused text field opens the on-screen keyboard over the window)
 *
 * @param {{ part: string, isPhone: boolean, parts?: Object[] }} state
 */
export function startsOnHeading({ part, isPhone, parts = ACCOUNT_PARTS }) {
	if (isPhone) return true;
	return parts.find((entry) => entry.id === part)?.start === "heading";
}

const IDLE = { dirty: false, locked: false, busy: false };

/**
 * The parts' states after one part reported: dirty (unsaved changes), locked (a step only Done ends), busy (a request
 * runs). The same object when nothing changed, so a React state setter skips the render.
 *
 * @param {Object} states  part id -> { dirty, locked, busy }
 * @param {string} id
 * @param {{ dirty?: *, locked?: *, busy?: * }} report
 */
export function reportPart(states, id, report) {
	const before = states[id] ?? IDLE;
	const next = { dirty: Boolean(report.dirty), locked: Boolean(report.locked), busy: Boolean(report.busy) };
	if (before.dirty === next.dirty && before.locked === next.locked && before.busy === next.busy) return states;
	return { ...states, [id]: next };
}

/**
 * The frame's view of its parts: the parts with unsaved changes in side list order, whether one is locked or busy,
 * and whether the window may close (Close, the X and Escape; with dirty parts it asks first)
 *
 * @param {Object}   states
 * @param {Object[]} [parts]  the window's parts, in side list order
 */
export function frameState(states, parts = ACCOUNT_PARTS) {
	const entries = parts.map(({ id }) => [id, states[id] ?? IDLE]);
	const dirtyParts = entries.filter(([, state]) => state.dirty).map(([id]) => id);
	const locked = entries.some(([, state]) => state.locked);
	const busy = entries.some(([, state]) => state.busy);
	return { dirtyParts, locked, busy, closable: !(locked || busy) };
}

/** The parts mounted so far: a part mounts on its first visit and stays mounted (its edits stay) */
export const visitPart = (visited, part) => (visited.includes(part) ? visited : [...visited, part]);

/** The other part with unsaved changes that the open part's footer names, the first in side list order, or null */
export const otherDirtyPart = (dirtyParts, part) => dirtyParts.find((id) => id !== part) ?? null;

const CODE_STEPS = new Set(["setup", "disable", "verify"]);

/** The MFA part's report: a started step is an unsaved change, the backup codes step locks the window */
export const mfaStepReport = (step) => ({ dirty: CODE_STEPS.has(step), locked: step === "backup" });

/**
 * Where the focus goes when an MFA step replaces another (the pressed button is gone): the code on a desktop, the
 * Done button of the backup codes, else the part heading (also for a code step on a phone, as the window start)
 *
 * @param {{ step: string, isPhone: boolean }} state
 * @returns {"code"|"done"|"heading"}
 */
export function mfaStepFocus({ step, isPhone }) {
	if (step === "backup") return "done";
	if (CODE_STEPS.has(step) && !isPhone) return "code";
	return "heading";
}

/**
 * The sign-in actions an administrator may take for a user, in menu order: the rules of the Users row menu, shared
 * with the Sign-in part of another user's window. Nothing for the own account (it has its own window); Reset MFA only
 * with MFA on; Unlink OIDC only with an OIDC link.
 *
 * @param {{ isSelf: boolean, hasMfa: boolean, oidcLinked: boolean }} user
 * @returns {Array<"set-password"|"reset-mfa"|"revoke-sessions"|"unlink-oidc">}
 */
export function signInActions({ isSelf, hasMfa, oidcLinked }) {
	if (isSelf) return [];
	return [
		"set-password",
		...(hasMfa ? ["reset-mfa"] : []),
		"revoke-sessions",
		...(oidcLinked ? ["unlink-oidc"] : []),
	];
}
