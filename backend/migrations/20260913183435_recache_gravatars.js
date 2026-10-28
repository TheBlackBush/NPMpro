import { mkdir, rm } from "node:fs/promises";
import { migrate as logger } from "../logger.js";

const migrateName = "recache_gravatars";

/**
 * Migrate
 *
 * @see https://knexjs.org/guide/migrations.html#migration-api
 *
 * @param   {Object} knex
 * @param   {Object} [options] the gravatar folder and the user module, replaceable in tests
 * @returns {Promise}
 */
const up = async (
	knex,
	{ gravatarDir = "/data/npmpro/gravatar", loadUser = () => import("../internal/user.js") } = {},
) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	const users = await knex("user").select("id", "email", "name", "avatar").where("is_deleted", 0);
	// an empty database (a new install or a database move target) has no avatars to fetch again
	if (users.length === 0) {
		logger.info(`[${migrateName}] no users, nothing to re-fetch`);
		return;
	}

	await rm(gravatarDir, { recursive: true, force: true });
	await mkdir(gravatarDir, { recursive: true });

	// imported here: the models connect to the database in use when loaded
	const { default: internalUser } = await loadUser();
	for (const user of users) {
		if (user.avatar?.startsWith("/images/avatar/")) continue;
		await knex("user")
			.where("id", user.id)
			.update({ avatar: await internalUser.fetchGravatar(user.id, user.email, user.name) });
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
