import dnsPlugins from "../certbot/dns-plugins.json" with { type: "json" };
import { defaultSecretBox } from "../lib/secret-box.js";
import { migrate as logger } from "../logger.js";

const migrateName = "dns_credentials";

/**
 * Migrate
 *
 * @see https://knexjs.org/guide/migrations.html#migration-api
 *
 * @param   {Object}  knex
 * @param   {Object}  [options]          tests inject encrypt
 * @returns {Promise}
 */
const up = async (knex, { encrypt = defaultSecretBox.encrypt } = {}) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	await knex.schema.createTable("npmplus_dns_credential", (table) => {
		table.increments().primary();
		table.dateTime("created_on").notNull();
		table.dateTime("modified_on").notNull();
		table.integer("owner_user_id").notNull().unsigned();
		table.string("name", 255).notNull();
		table.string("provider", 255).notNull();
		table.text("values").notNull();
		table.unique(["owner_user_id", "name"]);
	});
	await knex.schema.alterTable("certificate", (table) => {
		table.integer("npmplus_dns_credential_id").unsigned().nullable().defaultTo(null);
	});
	logger.info(`[${migrateName}] npmplus_dns_credential Table created`);

	const now = knex.fn.now();
	const groups = new Map();
	const certificates = await knex("certificate")
		.where("npmplus_dns_challenge", 1)
		.select("id", "owner_user_id", "npmplus_dns_provider", "npmplus_dns_provider_credentials")
		.orderBy("id");

	for (const cert of certificates) {
		const groupKey = JSON.stringify([
			cert.owner_user_id,
			cert.npmplus_dns_provider,
			cert.npmplus_dns_provider_credentials,
		]);
		if (!groups.has(groupKey)) {
			const baseName = dnsPlugins[cert.npmplus_dns_provider]?.name ?? cert.npmplus_dns_provider;
			const sameProvider = [...groups.values()].filter(
				(group) => group.owner === cert.owner_user_id && group.provider === cert.npmplus_dns_provider,
			).length;
			const [inserted] = await knex("npmplus_dns_credential").insert(
				{
					created_on: now,
					modified_on: now,
					owner_user_id: cert.owner_user_id,
					name: sameProvider === 0 ? baseName : `${baseName} ${sameProvider + 1}`,
					provider: cert.npmplus_dns_provider,
					values: encrypt({ ini: cert.npmplus_dns_provider_credentials }),
				},
				["id"],
			);
			groups.set(groupKey, {
				id: typeof inserted === "object" ? inserted.id : inserted,
				owner: cert.owner_user_id,
				provider: cert.npmplus_dns_provider,
			});
		}
		await knex("certificate")
			.where("id", cert.id)
			.update({ npmplus_dns_credential_id: groups.get(groupKey).id });
	}
	logger.info(`[${migrateName}] ${groups.size} DNS credential(s) created from ${certificates.length} certificate(s)`);

	await knex.schema.alterTable("certificate", (table) => {
		table.dropColumn("npmplus_dns_provider_credentials");
	});
	logger.info(`[${migrateName}] certificate Table altered`);
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
