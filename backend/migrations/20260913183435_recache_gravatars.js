import { fetchGravatar as fetchGravatarFile } from "../lib/gravatar.js";
import { migrate as logger } from "../logger.js";

const migrateName = "recache_gravatars";

/**
 * Migrate
 *
 * @see https://knexjs.org/guide/migrations.html#migration-api
 *
 * @param   {Object} knex
 * @param   {Object} [options]
 * @param   {Function} [options.fetchGravatar] (id, email, name) => avatar URL, replaceable in tests
 * @returns {Promise}
 */
const up = async (knex, { fetchGravatar = fetchGravatarFile } = {}) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	const users = await knex("user").select("id", "email", "name", "avatar").where("is_deleted", 0);
	// an empty database (a new install or a database move target) has no avatars to fetch again
	if (users.length === 0) {
		logger.info(`[${migrateName}] no users, nothing to re-fetch`);
		return;
	}

	for (const user of users) {
		if (user.avatar?.startsWith("/images/avatar/")) continue;
		await knex("user")
			.where("id", user.id)
			.update({ avatar: await fetchGravatar(user.id, user.email, user.name) });
	}

	logger.info(`[${migrateName}] re-fetched gravatars for ${users.length} users`);
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
