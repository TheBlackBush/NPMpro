import { migrate as logger } from "../logger.js";

const migrateName = "hard_delete";

/**
 * Migrate
 *
 * @see https://knexjs.org/guide/migrations.html#migration-api
 *
 * @param   {Object} knex
 * @param   {Object} [options] the user module, replaceable in tests
 * @returns {Promise}
 */
const up = async (knex, { loadUser = () => import("../internal/user.js") } = {}) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	await knex("npmplus_proxy_host_access_list")
		.whereIn("proxy_host_id", knex("proxy_host").select("id").where("is_deleted", 1))
		.delete();

	const accessListIds = await knex("access_list").where("is_deleted", 1).pluck("id");
	for (const table of ["npmplus_proxy_host_access_list", "access_list_auth", "access_list_client"]) {
		await knex(table).whereIn("access_list_id", accessListIds).delete();
	}

	for (const table of [
		"proxy_host",
		"redirection_host",
		"dead_host",
		"stream",
		"access_list",
		"certificate",
		"auth",
	]) {
		await knex(table).where("is_deleted", 1).delete();
	}

	logger.info(`[${migrateName}] deleted rows removed`);

	const userIds = await knex("user").where("is_deleted", 1).pluck("id");
	for (const table of ["auth", "user_permission"]) await knex(table).whereIn("user_id", userIds).delete();
	await knex("user").whereIn("id", userIds).delete();
	if (userIds.length > 0) {
		// imported here: the models connect to the database in use when loaded
		const { default: internalUser } = await loadUser();
		for (const id of userIds) await internalUser.deleteAvatarFiles(id);
	}

	logger.info(`[${migrateName}] removed ${userIds.length} deleted users`);

	await knex("user").update({ nickname: "" });
	await knex("proxy_host").update({ access_list_id: 0 });

	logger.info(`[${migrateName}] unused columns cleared`);
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
