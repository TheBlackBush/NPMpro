import errs from "../lib/error.js";
import { castJsonIfNeed } from "../lib/helpers.js";
import { assertHostConfig } from "../lib/host-config-guard.js";
import deadHostModel from "../models/dead_host.js";
import internalAuditLog from "./audit-log.js";
import internalCertificate from "./certificate.js";
import internalHost from "./host.js";
import internalNginx from "./nginx.js";

const internalDeadHost = {
	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @returns {Promise}
	 */
	create: async (access, data) => {
		let thisData = data;
		const createCertificate = await internalHost.checkCertificates(access, thisData);

		access.can("dead_hosts:manage");
		assertHostConfig(access, "dead_host", thisData);

		await internalHost.assertHostnamesFree(thisData.domain_names);

		// At this point the domains should have been checked
		thisData.owner_user_id = access.token.getUserId(1);
		thisData = internalHost.cleanSslHstsData(createCertificate, thisData);

		if (createCertificate) {
			thisData.certificate_id = (await internalCertificate.createQuickCertificate(access, thisData)).id;
		}

		const createdRow = await deadHostModel.query().insertAndFetch(thisData);

		let savedRow;
		try {
			const row = await internalDeadHost.get(access, {
				id: createdRow.id,
				expand: ["certificate"],
			});

			// Configure nginx
			await internalNginx.configure(deadHostModel, "dead_host", row);
		} finally {
			savedRow = await internalDeadHost.get(access, { id: createdRow.id });

			// Add to audit log
			await internalAuditLog.add(access, {
				action: "created",
				object_type: "dead-host",
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

		access.can("dead_hosts:manage");

		const existingRow = await internalDeadHost.get(access, { id: thisData.id });
		assertHostConfig(access, "dead_host", thisData, existingRow);

		if (thisData.domain_names !== undefined) {
			await internalHost.assertHostnamesFree(thisData.domain_names, {
				ignoreType: "dead",
				ignoreId: thisData.id,
			});
		}

		if (createCertificate) {
			const cert = await internalCertificate.createQuickCertificate(access, {
				...thisData,
				domain_names: thisData.domain_names || existingRow.domain_names,
			});

			// update host with cert id
			thisData.certificate_id = cert.id;
		}

		thisData = internalHost.cleanSslHstsData(createCertificate, thisData, existingRow);

		await deadHostModel.query().where({ id: thisData.id }).patch(thisData);

		let savedRow;
		try {
			const row = await internalDeadHost.get(access, {
				id: thisData.id,
				expand: ["certificate"],
			});

			// Configure nginx
			await internalNginx.configure(deadHostModel, "dead_host", row);
		} finally {
			savedRow = await internalDeadHost.get(access, { id: thisData.id });

			// Add to audit log
			await internalAuditLog.add(access, {
				action: "updated",
				object_type: "dead-host",
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
		access.can("dead_hosts:view");

		const query = deadHostModel.query().where("id", data.id).allowGraph("[certificate]").first();

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
		access.can("dead_hosts:manage");

		const row = await internalDeadHost.get(access, { id: data.id });

		await deadHostModel.query().deleteById(row.id);

		try {
			// Delete Nginx Config
			await internalNginx.removeConfig("dead_host", row);
		} finally {
			// Add to audit log
			await internalAuditLog.add(access, {
				action: "deleted",
				object_type: "dead-host",
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
		access.can("dead_hosts:manage");

		const row = await internalDeadHost.get(access, {
			id: data.id,
			expand: ["certificate"],
		});
		if (row.enabled) {
			throw new errs.ValidationError("Host is already enabled");
		}

		await internalHost.assertHostnamesFree(row.domain_names, { suffix: " by an active host" });

		row.enabled = 1;

		await deadHostModel.query().where("id", row.id).patch({
			enabled: 1,
		});

		let savedRow;
		try {
			// Configure nginx
			await internalNginx.configure(deadHostModel, "dead_host", row);
		} finally {
			savedRow = await internalDeadHost.get(access, { id: row.id });

			// Add to audit log
			await internalAuditLog.add(access, {
				action: "enabled",
				object_type: "dead-host",
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
		access.can("dead_hosts:manage");

		const row = await internalDeadHost.get(access, { id: data.id });
		if (!row.enabled) {
			throw new errs.ValidationError("Host is already disabled");
		}

		await deadHostModel.query().where("id", row.id).patch({
			enabled: 0,
		});

		let savedRow;
		try {
			// Delete Nginx Config
			await internalNginx.removeConfig("dead_host", row);
		} finally {
			savedRow = await internalDeadHost.get(access, { id: row.id });

			// Add to audit log
			await internalAuditLog.add(access, {
				action: "disabled",
				object_type: "dead-host",
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
		access.can("dead_hosts:view");

		const query = deadHostModel
			.query()
			.groupBy("id")
			.allowGraph("[owner,certificate]")
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

	getCount: (...args) => internalHost.hostCounts(deadHostModel).getCount(...args),
	getErrorCount: (...args) => internalHost.hostCounts(deadHostModel).getErrorCount(...args),
};

export default internalDeadHost;
