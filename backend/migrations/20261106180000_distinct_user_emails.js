import { migrate as logger } from "../logger.js";

const migrateName = "distinct_user_emails";

// the length of the user.email column
const MAX_LENGTH = 255;

// the address as the login looks it up: trimmed and lower case
const normalize = (email) =>
	String(email ?? "")
		.trim()
		.toLowerCase();

/**
 * A distinct address for a user that shares one: name+dup-<id>@domain, within the column length, not taken by anyone
 *
 * @param   {Object}      user
 * @param   {Set<string>} taken  the normalized addresses in use, the new one is added
 * @returns {string}
 */
const distinctAddress = ({ id, email }, taken) => {
	const address = normalize(email);
	const at = address.lastIndexOf("@");
	const local = at === -1 ? address : address.slice(0, at);
	const domain = at === -1 ? "" : address.slice(at);
	for (let n = 0; ; n++) {
		const suffix = n === 0 ? `+dup-${id}` : `+dup-${id}-${n}`;
		const room = MAX_LENGTH - suffix.length - domain.length;
		// a domain that leaves no room for the suffix is not a real address, the id alone is still distinct
		const candidate = room >= 1 ? `${local.slice(0, room)}${suffix}${domain}` : `dup-${id}-${n}`;
		if (!taken.has(candidate)) {
			taken.add(candidate);
			return candidate;
		}
	}
};

/**
 * Migrate
 *
 * Two users can share an address when the database is older than the rule that keeps addresses unique and lower case.
 * The login finds only one of them, so the other ones get a distinct address. The user the login finds keeps its
 * address (internal/token.js: enabled first, then the lowest id).
 *
 * @see https://knexjs.org/guide/migrations.html#migration-api
 *
 * @param   {Object} knex
 * @returns {Promise}
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	const users = await knex("user").select("id", "email", "is_disabled").orderBy("id");
	const groups = new Map();
	for (const user of users) {
		const key = normalize(user.email);
		groups.set(key, [...(groups.get(key) ?? []), user]);
	}
	const taken = new Set(groups.keys());

	const changed = [];
	for (const group of groups.values()) {
		if (group.length < 2) continue;
		// enabled first, then the lowest id: the users are sorted by id and the sort is stable
		const [, ...others] = [...group].sort(
			(a, b) => Number(Boolean(a.is_disabled)) - Number(Boolean(b.is_disabled)),
		);
		for (const user of others) {
			await knex("user")
				.where("id", user.id)
				.update({ email: distinctAddress(user, taken) });
			changed.push(user.id);
		}
	}

	if (changed.length > 0) {
		logger.warn(
			`[${migrateName}] users ${changed.join(", ")} shared an email address with another user and got a new one (name+dup-<id>@domain): tell them or change it under Users`,
		);
	}
	logger.info(`[${migrateName}] ${changed.length} duplicate addresses changed`);
};

/**
 * Undo Migrate
 *
 * @param   {Object} _knex
 * @returns {Promise}
 */
const down = (_knex) => {
	throw new Error(`[${migrateName}] You can't migrate down this one.`);
};

export { down, up };
