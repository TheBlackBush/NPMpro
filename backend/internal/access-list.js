import { rm } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { assertAccessListRules, assertCountryRules, clientsWithAddress } from "../lib/access-list-rules.js";
import errs from "../lib/error.js";
import { PROXY_HOST_GRAPH } from "../lib/host-expand.js";
import { removePlacePages, writePlacePages } from "../lib/landing-pages/files.js";
import { assertPageFields, keepSavedPages } from "../lib/landing-pages/html.js";
import { auditPageHtml, withoutPageHtml } from "../lib/landing-pages/types.js";
import { rooted } from "../lib/paths.js";
import { writeSecretFile } from "../lib/secret-file.js";
import { access as logger } from "../logger.js";
import accessListModel from "../models/access_list.js";
import accessListAuthModel from "../models/access_list_auth.js";
import accessListClientModel from "../models/access_list_client.js";
import accessListCountryModel from "../models/access_list_country.js";
import locationModel from "../models/location.js";
import proxyHostModel from "../models/proxy_host.js";
import internalAuditLog from "./audit-log.js";
import { geoipConfFailsOpen, geoipStatus, syncGeoipConfNow, writeGeoipLists } from "./geoip-nginx.js";
import { reportGeoipState } from "./geoip-state.js";
import internalNginx from "./nginx.js";
import { runtimeExclusive } from "./runtime-queue.js";

const proxyHostEntries = (hosts) => hosts.map((host) => ({ model: proxyHostModel, hostType: "proxy_host", host }));

const hasNoRules = (items = [], clients = [], countryRule = false) =>
	!countryRule &&
	items.length === 0 &&
	clients.every(({ address = "" }) => ["", "all"].includes(address.trim().toLowerCase()));

const countryRows = (listId, countries = []) =>
	countries.map(({ country, npmpro_comment }) => ({ access_list_id: listId, country, npmpro_comment }));

/**
 * In the runtime queue: geoip-lists.conf from the lists, and geoip.conf too when this list has a mode while the file
 * on disk lets every visitor pass (a Country file placed by hand is used at once, not at the hourly sync)
 *
 * @param {Object}  list
 * @param {Object}  options  { reload }
 */
const writeCountryIncludes = async (list, { reload }) => {
	await writeGeoipLists({ report: false });
	if (list.npmpro_geo_mode !== "off" && (await geoipConfFailsOpen())) await syncGeoipConfNow({ reload });
	else await reportGeoipState();
};

/** geoip-lists.conf after the host configs; a failure is logged, the save's own error stays the one that counts */
const rewriteGeoipLists = async () => {
	try {
		await runtimeExclusive(writeGeoipLists);
	} catch (err) {
		logger.error(`Could not write the country rules of access lists: ${err.message}`);
	}
};

const GEO_COLUMNS = ["npmpro_geo_mode", "npmpro_geo_unknown", "npmpro_geo_drop"];

const internalAccessList = {
	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @returns {Promise}
	 */
	create: async (access, data) => {
		access.can("access_lists:manage");
		if (data.items?.some((item) => !item.password)) {
			throw new errs.ValidationError("New access list users need a password");
		}
		if (data.items?.some((item) => item.password && bcrypt.truncates(item.password))) {
			throw new errs.ValidationError("Access list passwords can not be longer than 72 bytes");
		}
		assertCountryRules(data, null, await geoipStatus());
		const countryRule = (data.npmpro_geo_mode ?? "off") !== "off" && (data.npmpro_countries?.length ?? 0) > 0;
		if (hasNoRules(data.items, data.clients, countryRule)) {
			throw new errs.ValidationError("Access list needs at least one user or one rule that is not all");
		}
		assertAccessListRules(data);
		assertPageFields("access_list", data, {});

		const row = await accessListModel.transaction(async (trx) => {
			const insertedRow = await accessListModel.query(trx).insertAndFetch({
				name: data.name,
				satisfy_any: data.satisfy_any,
				pass_auth: data.pass_auth,
				npmpro_denied_page: data.npmpro_denied_page,
				npmpro_denied_page_html: data.npmpro_denied_page_html,
				npmpro_geo_mode: data.npmpro_geo_mode,
				npmpro_geo_unknown: data.npmpro_geo_unknown,
				npmpro_geo_drop: data.npmpro_geo_drop,
				owner_user_id: access.token.getUserId(1),
			});

			await Promise.all(
				(data.items ?? []).map(async (item) =>
					accessListAuthModel.query(trx).insert({
						access_list_id: insertedRow.id,
						username: item.username,
						password: await bcrypt.hash(item.password, 5),
					}),
				),
			);

			await Promise.all(
				clientsWithAddress(data.clients).map((client) =>
					accessListClientModel.query(trx).insert({
						access_list_id: insertedRow.id,
						address: client.address,
						directive: client.directive,
						npmpro_comment: client.npmpro_comment,
					}),
				),
			);

			for (const country of countryRows(insertedRow.id, data.npmpro_countries)) {
				await accessListCountryModel.query(trx).insert(country);
			}

			return insertedRow;
		});

		data.id = row.id;

		const freshRow = await internalAccessList.get(access, {
			id: data.id,
			expand: ["items", "clients", "npmpro_countries"],
		});

		try {
			// in the runtime queue like the host writes: a restore or another save never interleaves with the page write.
			// The country map first: a host saved with the new list right after names its variable
			await runtimeExclusive(async () => {
				await writeCountryIncludes(freshRow, { reload: true });
				await internalAccessList.build(freshRow);
			});
		} finally {
			await internalAuditLog.add(access, {
				action: "created",
				object_type: "access-list",
				object_id: freshRow.id,
				meta: auditPageHtml(freshRow),
			});
		}

		return freshRow;
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {Integer} data.id
	 * @param  {String}  [data.name]
	 * @param  {String}  [data.items]
	 * @return {Promise}
	 */
	update: async (access, data) => {
		access.can("access_lists:manage");
		const row = await internalAccessList.get(access, {
			id: data.id,
			expand: ["items", "clients", "npmpro_countries"],
		});
		if (
			data.items?.some((item) => !item.password && !row.items.some(({ username }) => username === item.username))
		) {
			throw new errs.ValidationError("New access list users need a password");
		}
		if (data.items?.some((item) => item.password && bcrypt.truncates(item.password))) {
			throw new errs.ValidationError("Access list passwords can not be longer than 72 bytes");
		}
		assertCountryRules(data, row, await geoipStatus());
		const geoMode = data.npmpro_geo_mode ?? row.npmpro_geo_mode;
		const countryRule = geoMode !== "off" && (data.npmpro_countries ?? row.npmpro_countries).length > 0;
		if (hasNoRules(data.items ?? row.items, data.clients ?? row.clients, countryRule)) {
			throw new errs.ValidationError("Access list needs at least one user or one rule that is not all");
		}
		assertAccessListRules(data);
		assertPageFields("access_list", data, row);
		keepSavedPages("access_list", data, row);

		await accessListModel.transaction(async (trx) => {
			const columns = {
				name: data.name,
				satisfy_any: data.satisfy_any,
				pass_auth: data.pass_auth,
				npmpro_denied_page: data.npmpro_denied_page,
				npmpro_denied_page_html: data.npmpro_denied_page_html,
				...Object.fromEntries(GEO_COLUMNS.map((column) => [column, data[column]])),
			};
			if (Object.values(columns).some((value) => value !== undefined)) {
				await accessListModel.query(trx).where({ id: data.id }).patch(columns);
			}

			if (data.items) {
				// Items supplied with an empty password are kept, but their password is left untouched
				await accessListAuthModel
					.query(trx)
					.delete()
					.where("access_list_id", data.id)
					.whereNotIn(
						"username",
						data.items.filter((item) => !item.password).map((item) => item.username),
					);
				await Promise.all(
					data.items
						.filter((item) => item.password)
						.map(async (item) =>
							accessListAuthModel.query(trx).insert({
								access_list_id: data.id,
								username: item.username,
								password: await bcrypt.hash(item.password, 5),
							}),
						),
				);
			}

			if (data.clients) {
				await accessListClientModel.query(trx).delete().where("access_list_id", data.id);

				await Promise.all(
					clientsWithAddress(data.clients).map((client) =>
						accessListClientModel.query(trx).insert({
							access_list_id: data.id,
							address: client.address,
							directive: client.directive,
							npmpro_comment: client.npmpro_comment,
						}),
					),
				);
			}

			if (data.npmpro_countries) {
				await accessListCountryModel.query(trx).delete().where("access_list_id", data.id);
				for (const country of countryRows(data.id, data.npmpro_countries)) {
					await accessListCountryModel.query(trx).insert(country);
				}
			}
		});

		const freshRow = await internalAccessList.get(access, {
			id: data.id,
			expand: ["items", "clients", "npmpro_countries", `proxy_hosts.${PROXY_HOST_GRAPH}`],
		});

		const savedRow = { ...freshRow, proxy_hosts: undefined };

		try {
			// in the runtime queue like the host writes: a restore or another save never interleaves with the page write.
			// The country maps before the host configs, so the batch nginx -t sees the variables the new gates name; a
			// list turned off keeps a passing variable while the old configs still name it
			await runtimeExclusive(async () => {
				await writeCountryIncludes(freshRow, { reload: false });
				await internalAccessList.build(freshRow);
			});
			try {
				await internalNginx.configureMany(proxyHostEntries(freshRow.proxy_hosts));
			} finally {
				// also after a failed batch: the file follows the configs on disk (a restored old config keeps a
				// passing variable)
				if (row.npmpro_geo_mode !== "off" && freshRow.npmpro_geo_mode === "off") await rewriteGeoipLists();
			}
			// behind every nginx -t of the queue (a geoip.conf sync tests its database line before nginx loads it)
			await runtimeExclusive(() => internalNginx.reloadOrRaise({ id: data.id }));
		} finally {
			await internalAuditLog.add(access, {
				action: "updated",
				object_type: "access-list",
				object_id: data.id,
				meta: auditPageHtml(savedRow),
			});
		}

		return savedRow;
	},

	/**
	 * @param  {Access}   access
	 * @param  {Object}   data
	 * @param  {Integer}  data.id
	 * @param  {Array}    [data.expand]
	 * @return {Promise}
	 */
	get: async (access, data) => {
		access.can("access_lists:view");

		const query = accessListModel
			.query()
			.select("access_list.*", accessListModel.raw("COUNT(DISTINCT proxy_host.id) as proxy_host_count"))
			.leftJoin("npmpro_proxy_host_access_list", "npmpro_proxy_host_access_list.access_list_id", "access_list.id")
			.leftJoin("proxy_host", "proxy_host.id", "npmpro_proxy_host_access_list.proxy_host_id")
			.where("access_list.id", data.id)
			.groupBy("access_list.id")
			.allowGraph(`[items,clients,npmpro_countries,proxy_hosts.${PROXY_HOST_GRAPH}]`)
			.first();

		if (access.visibility !== "all") {
			query.andWhere("access_list.owner_user_id", access.token.getUserId(1));
		}

		if (data.expand) query.withGraphFetched(`[${data.expand.join(", ")}]`);

		const row = await query;
		if (!row?.id) {
			throw new errs.ItemNotFoundError(data.id);
		}
		if (Array.isArray(row.proxy_hosts)) {
			row.proxy_hosts = [...new Map(row.proxy_hosts.map((host) => [host.id, host])).values()];
		}

		return row;
	},

	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @param   {Integer} data.id
	 * @param   {String}  [data.reason]
	 * @returns {Promise}
	 */
	delete: async (access, data) => {
		access.can("access_lists:manage");
		const row = await internalAccessList.get(access, {
			id: data.id,
			expand: [`proxy_hosts.${PROXY_HOST_GRAPH}`, "items", "clients", "npmpro_countries"],
		});
		// 1. update row to be deleted
		// 2. update any proxy hosts that were using it (ignoring permissions)
		// 3. reconfigure those hosts
		// 4. audit log

		const affectedHosts = (row.proxy_hosts || []).map((host) => {
			const updatedHost = { ...host };
			if (!Array.isArray(updatedHost.access_lists)) {
				updatedHost.access_lists = [];
			}
			updatedHost.access_lists = updatedHost.access_lists.filter((acl) => acl.id !== row.id);

			if (updatedHost.access_lists.length === 0) {
				updatedHost.npmpro_access_list_type = "public";
			}
			if (!Array.isArray(updatedHost.locations)) {
				throw new errs.ConfigurationError("Invalid location structure. Expected an array");
			}
			updatedHost.locations = updatedHost.locations.map((location) => {
				const updatedLocation = { ...location };
				updatedLocation.access_lists = updatedLocation.access_lists.filter((acl) => acl.id !== row.id);
				if (updatedLocation.access_lists.length === 0 && updatedLocation.npmpro_access_list_type === "custom") {
					updatedLocation.npmpro_access_list_type = "global";
				}
				return updatedLocation;
			});
			return updatedHost;
		});
		const deletedRow = { ...row, proxy_hosts: undefined };

		await accessListModel.transaction(async (trx) => {
			await trx("npmpro_proxy_host_access_list").where("access_list_id", row.id).delete();
			await accessListAuthModel.query(trx).where("access_list_id", row.id).delete();
			await accessListClientModel.query(trx).where("access_list_id", row.id).delete();
			await accessListCountryModel.query(trx).where("access_list_id", row.id).delete();
			await accessListModel.query(trx).deleteById(row.id);
			// every host that used it, also those the user cannot edit
			for (const host of affectedHosts) {
				await proxyHostModel.query(trx).findById(host.id).patch({
					npmpro_access_list_type: host.npmpro_access_list_type,
				});
				for (const location of host.locations) {
					await locationModel.query(trx).where("id", location.id).patch({
						npmpro_access_list_type: location.npmpro_access_list_type,
					});
				}
			}
		});

		try {
			try {
				await internalNginx.configureMany(proxyHostEntries(affectedHosts));
			} finally {
				// the country map after the host configs, which named its variable until they were rewritten; also after a
				// failed batch, so the deleted list's map goes (a restored old config gets a passing variable)
				await rewriteGeoipLists();
			}

			await runtimeExclusive(() => internalNginx.reloadOrRaise(undefined, { change: true }));

			await runtimeExclusive(async () => {
				await rm(internalAccessList.getFilename(row), { force: true });
				await removePlacePages("access_list", row.id);
			});
		} finally {
			await internalAuditLog.add(access, {
				action: "deleted",
				object_type: "access-list",
				object_id: row.id,
				meta: auditPageHtml(deletedRow),
			});
		}
		return deletedRow;
	},

	/**
	 * @param   {Access}  access
	 * @param   {Array}   [expand]
	 * @param   {String}  [searchQuery]
	 * @returns {Promise}
	 */
	getAll: (access, expand, searchQuery) => {
		access.can("access_lists:view");

		const query = accessListModel
			.query()
			.select("access_list.*", accessListModel.raw("COUNT(DISTINCT proxy_host.id) as proxy_host_count"))
			.leftJoin("npmpro_proxy_host_access_list", "npmpro_proxy_host_access_list.access_list_id", "access_list.id")
			.leftJoin("proxy_host", "proxy_host.id", "npmpro_proxy_host_access_list.proxy_host_id")
			.groupBy("access_list.id")
			.allowGraph("[owner,items,clients,npmpro_countries]")
			.orderBy("access_list.name", "ASC");

		if (access.visibility !== "all") {
			query.andWhere("access_list.owner_user_id", access.token.getUserId(1));
		}

		if (typeof searchQuery === "string") {
			query.where(function () {
				this.where("name", "like", `%${searchQuery}%`);
			});
		}

		if (expand) query.withGraphFetched(`[${expand.join(", ")}]`);

		query.runAfter((rows) => (Array.isArray(rows) ? rows.map(withoutPageHtml) : rows));

		return query;
	},

	/**
	 * What the country rules of the access lists page need: whether a country database can be used, which provider is
	 * active, whether a custom geoip_country directive wins, and how many visible lists have a country mode on
	 *
	 * @param   {Access}  access
	 * @returns {Promise<{available: boolean, provider: string, custom_directive: boolean, lists_with_rules: number}>}
	 */
	geoip: async (access) => {
		access.can("access_lists:view");
		const status = await geoipStatus();
		const query = accessListModel.query().whereNot("npmpro_geo_mode", "off");
		if (access.visibility !== "all") {
			query.andWhere("owner_user_id", access.token.getUserId(1));
		}
		return {
			available: status.available,
			provider: status.provider,
			custom_directive: status.custom_directive,
			lists_with_rules: await query.resultSize(),
		};
	},

	/**
	 * @param   {Integer} userId
	 * @param   {String}  visibility
	 * @returns {Promise}
	 */
	getCount: (userId, visibility) => {
		const query = accessListModel.query();

		if (visibility !== "all") {
			query.andWhere("owner_user_id", userId);
		}

		return query.resultSize();
	},

	/**
	 * @param   {Object}  list
	 * @param   {Integer} list.id
	 * @returns {String}
	 */
	getFilename: (list) => rooted(`/data/access/${list.id}`),

	/**
	 * @param {*} htpasswdFile
	 * @param {*} items
	 */
	writeData: async (htpasswdFile, items) => {
		const validItems = (items ?? []).filter((item) => item.username?.length > 0 && item.password?.length > 0);
		for (const item of validItems) logger.info(`Adding: ${item.username}`);
		await writeSecretFile(htpasswdFile, validItems.map((item) => `${item.username}:${item.password}\n`).join(""), {
			workerReadable: true,
		});
	},

	/**
	 * @param   {Object}  list
	 * @param   {Integer} list.id
	 * @param   {String}  list.name
	 * @param   {Array}   list.items
	 * @returns {Promise}
	 */
	build: async (list) => {
		logger.info(`Building Access file #${list.id} for: ${list.name}`);

		const htpasswdFile = internalAccessList.getFilename(list);

		await rm(htpasswdFile, { force: true });
		await internalAccessList.writeData(htpasswdFile, list.items);
		await writePlacePages("access_list", list);

		logger.success(`Built Access file #${list.id} for: ${list.name}`);
	},
};

export default internalAccessList;
