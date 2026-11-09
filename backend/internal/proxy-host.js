import errs from "../lib/error.js";
import { castJsonIfNeed } from "../lib/helpers.js";
import { assertHostConfig } from "../lib/host-config-guard.js";
import { PROXY_HOST_EXPAND, PROXY_HOST_GRAPH } from "../lib/host-expand.js";
import locationModel from "../models/location.js";
import proxyHostModel from "../models/proxy_host.js";
import internalAuditLog from "./audit-log.js";
import internalCertificate from "./certificate.js";
import internalHost from "./host.js";
import internalNginx from "./nginx.js";
import internalProxyHostAccessList from "./proxy-host-access-list.js";

const replaceLocationsAndAccessLists = async (trx, proxyHostId, data) => {
	const insertAccessLists = async (locationId, accessListIds) => {
		if (accessListIds.length > 0) {
			await trx("npmpro_proxy_host_access_list").insert(
				accessListIds.map((access_list_id, position) => ({
					proxy_host_id: proxyHostId,
					location_id: locationId,
					access_list_id,
					position,
				})),
			);
		}
	};

	await trx("npmpro_proxy_host_access_list").where("proxy_host_id", proxyHostId).delete();
	await locationModel.query(trx).where("proxy_host_id", proxyHostId).delete();
	await insertAccessLists(0, data.npmpro_access_list_ids);
	for (const { id, npmpro_access_list_ids: accessListIds, ...location } of data.locations ?? []) {
		await insertAccessLists(
			(await locationModel.query(trx).insert({ ...location, proxy_host_id: proxyHostId })).id,
			accessListIds,
		);
	}
};

const cleanForwardOptions = (item) => {
	const scheme = item.forward_scheme ?? "http";
	if (scheme !== "empty") {
		if (!["http", "https"].includes(scheme)) {
			item.npmpro_proxy_request_buffering = false;
			item.npmpro_proxy_response_buffering = false;
		}
		if (scheme === "path") {
			item.npmpro_upstream_compression = false;
		} else {
			item.npmpro_fancyindex = false;
		}
	}
	if (!item.npmpro_crowdsec_appsec) item.npmpro_proxy_request_buffering = false;
	if ((item.npmpro_auth_request ?? "none") === "none") item.npmpro_auth_request_upstream = "";
};

const internalProxyHost = {
	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @returns {Promise}
	 */
	create: async (access, data) => {
		let thisData = data;
		const createCertificate = await internalHost.checkCertificates(access, thisData);

		access.can("proxy_hosts:manage");
		assertHostConfig(access, "proxy_host", thisData);

		await internalHost.assertHostnamesFree(thisData.domain_names);

		// At this point the domains should have been checked
		thisData.owner_user_id = access.token.getUserId(1);
		thisData = internalHost.cleanSslHstsData(createCertificate, thisData);
		thisData = internalProxyHostAccessList.cleanAccessListTypes(thisData);
		for (const item of [thisData, ...(thisData.locations ?? [])]) cleanForwardOptions(item);
		await internalProxyHostAccessList.validateAccessLists(access, thisData);

		if (createCertificate) {
			thisData.certificate_id = (await internalCertificate.createQuickCertificate(access, thisData)).id;
		}

		const createdRow = await proxyHostModel.transaction(async (trx) => {
			const insertedRow = await proxyHostModel.query(trx).insertAndFetch(thisData);
			await replaceLocationsAndAccessLists(trx, insertedRow.id, thisData);
			return insertedRow;
		});

		let savedRow;
		try {
			const row = await internalProxyHost.get(access, {
				id: createdRow.id,
				expand: PROXY_HOST_EXPAND,
			});

			// Configure nginx
			await internalNginx.configure(proxyHostModel, "proxy_host", row);
		} finally {
			savedRow = await internalProxyHost.get(access, { id: createdRow.id });

			// Add to audit log
			await internalAuditLog.add(access, {
				action: "created",
				object_type: "proxy-host",
				object_id: savedRow.id,
				meta: savedRow,
			});
		}

		return savedRow;
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {Number}  data.id
	 * @return {Promise}
	 */
	update: async (access, data) => {
		let thisData = data;
		const createCertificate = await internalHost.checkCertificates(access, thisData);

		access.can("proxy_hosts:manage");

		const existingRow = await internalProxyHost.get(access, { id: thisData.id });
		assertHostConfig(access, "proxy_host", thisData, existingRow);

		if (thisData.domain_names !== undefined) {
			await internalHost.assertHostnamesFree(thisData.domain_names, {
				ignoreType: "proxy",
				ignoreId: thisData.id,
			});
		}

		// everything is checked before a new certificate is requested, so a refused save leaves no certificate behind
		thisData = internalHost.cleanSslHstsData(createCertificate, thisData, existingRow);
		thisData = internalProxyHostAccessList.cleanAccessListTypes(thisData);
		for (const item of [thisData, ...(thisData.locations ?? [])]) cleanForwardOptions(item);
		await internalProxyHostAccessList.validateAccessLists(access, thisData);

		if (createCertificate) {
			const cert = await internalCertificate.createQuickCertificate(access, {
				...thisData,
				domain_names: thisData.domain_names || existingRow.domain_names,
			});

			// update host with cert id
			thisData.certificate_id = cert.id;
		}

		await proxyHostModel.transaction(async (trx) => {
			await proxyHostModel.query(trx).where({ id: thisData.id }).patch(thisData);
			await replaceLocationsAndAccessLists(trx, thisData.id, thisData);
		});

		let savedRow;
		try {
			const row = await internalProxyHost.get(access, {
				id: thisData.id,
				expand: PROXY_HOST_EXPAND,
			});

			// Configure nginx
			await internalNginx.configure(proxyHostModel, "proxy_host", row);
		} finally {
			savedRow = await internalProxyHost.get(access, { id: thisData.id });

			// Add to audit log
			await internalAuditLog.add(access, {
				action: "updated",
				object_type: "proxy-host",
				object_id: savedRow.id,
				meta: savedRow,
			});
		}

		return savedRow;
	},

	/**
	 * @param  {Access}   access
	 * @param  {Object}   data
	 * @param  {Number}   data.id
	 * @param  {Array}    [data.expand]
	 * @return {Promise}
	 */
	get: async (access, data) => {
		access.can("proxy_hosts:view");

		const query = proxyHostModel
			.query()
			.where("id", data.id)
			.allowGraph(PROXY_HOST_GRAPH)
			.withGraphFetched("[access_lists, locations.access_lists]")
			.first();

		if (access.visibility !== "all") {
			query.andWhere("owner_user_id", access.token.getUserId(1));
		}

		if (data.expand) query.withGraphFetched(`[${data.expand.join(", ")}]`);

		const row = await query;
		if (!row?.id) {
			throw new errs.ItemNotFoundError(data.id);
		}

		return row;
	},

	/**
	 * @param {Access}  access
	 * @param {Object}  data
	 * @param {Number}  data.id
	 * @param {String}  [data.reason]
	 * @returns {Promise}
	 */
	delete: async (access, data) => {
		access.can("proxy_hosts:manage");

		const row = await internalProxyHost.get(access, { id: data.id });

		await proxyHostModel.transaction(async (trx) => {
			await trx("npmpro_proxy_host_access_list").where("proxy_host_id", row.id).delete();
			await locationModel.query(trx).where("proxy_host_id", row.id).delete();
			await proxyHostModel.query(trx).deleteById(row.id);
		});

		try {
			// Delete Nginx Config
			await internalNginx.removeConfig("proxy_host", row, {
				also: () => internalProxyHostAccessList.delete(row),
			});
		} finally {
			// Add to audit log
			await internalAuditLog.add(access, {
				action: "deleted",
				object_type: "proxy-host",
				object_id: row.id,
				meta: row,
			});
		}

		return row;
	},

	/**
	 * @param {Access}  access
	 * @param {Object}  data
	 * @param {Number}  data.id
	 * @param {String}  [data.reason]
	 * @returns {Promise}
	 */
	enable: async (access, data) => {
		access.can("proxy_hosts:manage");

		const row = await internalProxyHost.get(access, {
			id: data.id,
			expand: PROXY_HOST_EXPAND,
		});
		if (row.enabled) {
			throw new errs.ValidationError("Host is already enabled");
		}

		await internalHost.assertHostnamesFree(row.domain_names, { suffix: " by an active host" });

		row.enabled = 1;

		await proxyHostModel.query().where("id", row.id).patch({
			enabled: 1,
		});

		let savedRow;
		try {
			// Configure nginx
			await internalNginx.configure(proxyHostModel, "proxy_host", row);
		} finally {
			savedRow = await internalProxyHost.get(access, { id: row.id });

			// Add to audit log
			await internalAuditLog.add(access, {
				action: "enabled",
				object_type: "proxy-host",
				object_id: row.id,
				meta: savedRow,
			});
		}

		return savedRow;
	},

	/**
	 * @param {Access}  access
	 * @param {Object}  data
	 * @param {Number}  data.id
	 * @param {String}  [data.reason]
	 * @returns {Promise}
	 */
	disable: async (access, data) => {
		access.can("proxy_hosts:manage");

		const row = await internalProxyHost.get(access, { id: data.id });
		if (!row.enabled) {
			throw new errs.ValidationError("Host is already disabled");
		}

		await proxyHostModel.query().where("id", row.id).patch({
			enabled: 0,
		});

		let savedRow;
		try {
			// Delete Nginx Config
			await internalNginx.removeConfig("proxy_host", row);
		} finally {
			savedRow = await internalProxyHost.get(access, { id: row.id });

			// Add to audit log
			await internalAuditLog.add(access, {
				action: "disabled",
				object_type: "proxy-host",
				object_id: row.id,
				meta: savedRow,
			});
		}

		return savedRow;
	},

	/**
	 * All Hosts
	 *
	 * @param   {Access}  access
	 * @param   {Array}   [expand]
	 * @param   {String}  [searchQuery]
	 * @returns {Promise}
	 */
	getAll: (access, expand, searchQuery) => {
		access.can("proxy_hosts:view");

		const query = proxyHostModel
			.query()
			.groupBy("id")
			.allowGraph("[owner,access_lists,certificate,locations.access_lists]")
			.withGraphFetched("[access_lists, locations.access_lists]")
			.orderBy(castJsonIfNeed("domain_names"), "ASC");

		if (access.visibility !== "all") {
			query.andWhere("owner_user_id", access.token.getUserId(1));
		}

		// Query is used for searching
		if (typeof searchQuery === "string" && searchQuery.length > 0) {
			query.where(function () {
				this.where(castJsonIfNeed("domain_names"), "like", `%${searchQuery}%`);
			});
		}

		if (expand) query.withGraphFetched(`[${expand.join(", ")}]`);

		return query;
	},

	getCount: (...args) => internalHost.hostCounts(proxyHostModel).getCount(...args),
	getErrorCount: (...args) => internalHost.hostCounts(proxyHostModel).getErrorCount(...args),
};

export default internalProxyHost;
