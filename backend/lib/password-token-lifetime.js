// How long a password token lives, by purpose: the one place of these numbers (the token table, the invitation mail)
const LIFETIME_MS = { reset: 30 * 60_000, invite: 72 * 60 * 60_000 };
const INVITE_HOURS = LIFETIME_MS.invite / (60 * 60_000);

export { INVITE_HOURS, LIFETIME_MS };
