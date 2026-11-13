import { rm } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { assertAccessListRules, clientsWithAddress } from "../lib/access-list-rules.js";
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
import locationModel from "../models/location.js";
import proxyHostModel from "../models/proxy_host.js";
import internalAuditLog from "./audit-log.js";
import internalNginx from "./nginx.js";
import { runtimeExclusive } from "./runtime-queue.js";

const proxyHostEntries = (hosts) => hosts.map((host) => ({ model: proxyHostModel, hostType: "proxy_host", host }));

const hasNoRules = (items = [], clients = []) =>
	items.length === 0 && clients.every(({ address = "" }) => ["", "all"].includes(address.trim().toLowerCase()));

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
		if (hasNoRules(data.items, data.clients)) {
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
					}),
				),
			);

			return insertedRow;
		});

		data.id = row.id;

		const freshRow = await internalAccessList.get(access, {
			id: data.id,
			expand: ["items", "clients"],
		});

		try {
			// in the runtime queue like the host writes: a restore or another save never interleaves with the page write
			await runtimeExclusive(() => internalAccessList.build(freshRow));
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
		const row = await internalAccessList.get(access, { id: data.id, expand: ["items", "clients"] });
		if (
			data.items?.some((item) => !item.password && !row.items.some(({ username }) => username === item.username))
		) {
			throw new errs.ValidationError("New access list users need a password");
		}
		if (data.items?.some((item) => item.password && bcrypt.truncates(item.password))) {
			throw new errs.ValidationError("Access list passwords can not be longer than 72 bytes");
		}
		if (hasNoRules(data.items ?? row.items, data.clients ?? row.clients)) {
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
						}),
					),
				);
			}
		});

		const freshRow = await internalAccessList.get(access, {
			id: data.id,
			expand: ["items", "clients", `proxy_hosts.${PROXY_HOST_GRAPH}`],
		});

		const savedRow = { ...freshRow, proxy_hosts: undefined };

		try {
			// in the runtime queue like the host writes: a restore or another save never interleaves with the page write
			await runtimeExclusive(() => internalAccessList.build(freshRow));
			await internalNginx.configureMany(proxyHostEntries(freshRow.proxy_hosts));
			await internalNginx.reload();
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
			.allowGraph(`[items,clients,proxy_hosts.${PROXY_HOST_GRAPH}]`)
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
			expand: [`proxy_hosts.${PROXY_HOST_GRAPH}`, "items", "clients"],
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
			await internalNginx.configureMany(proxyHostEntries(affectedHosts));

			await internalNginx.reload();

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
			.allowGraph("[owner,items,clients]")
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
