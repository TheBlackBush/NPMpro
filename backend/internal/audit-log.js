import errs from "../lib/error.js";
import { castJsonIfNeed } from "../lib/helpers.js";
import auditLogModel from "../models/audit-log.js";

const internalAuditLog = {
	/**
	 * @param   {Access}  access
	 * @param   {Object}  [options]
	 * @param   {Array}   [options.expand]
	 * @param   {String}  [options.query]
	 * @param   {Number}  [options.limit]
	 * @param   {Number}  [options.offset]
	 * @param   {String}  [options.objectType]
	 * @param   {String}  [options.action]
	 * @param   {Number}  [options.userId]
	 * @returns {Promise<{rows: Array, total: Number}>}
	 */
	getAll: async (access, { expand, query: searchQuery, limit = 50, offset = 0, objectType, action, userId } = {}) => {
		access.canAdmin();

		const applyFilters = (query) => {
			if (typeof searchQuery === "string" && searchQuery.length > 0) {
				query.where(function () {
					this.where(castJsonIfNeed("meta"), "like", `%${searchQuery}%`);
				});
			}
			if (objectType) query.andWhere("object_type", objectType);
			if (action) query.andWhere("action", action);
			if (userId) query.andWhere("user_id", userId);
			return query;
		};

		const rowsQuery = applyFilters(auditLogModel.query())
			.orderBy("created_on", "DESC")
			.orderBy("id", "DESC")
			.limit(limit)
			.offset(offset)
			.allowGraph("[user]");
		if (expand) rowsQuery.withGraphFetched(`[${expand.join(", ")}]`);

		const [rows, total] = await Promise.all([rowsQuery, applyFilters(auditLogModel.query()).resultSize()]);
		return { rows, total };
	},

	/**
	 * @param  {Access}   access
	 * @param  {Object}   [data]
	 * @param  {Integer}  [data.id]          Defaults to the token user
	 * @param  {Array}    [data.expand]
	 * @return {Promise}
	 */
	get: async (access, data) => {
		access.canAdmin();

		const query = auditLogModel.query().andWhere("id", data.id).allowGraph("[user]").first();

		if (data.expand) query.withGraphFetched(`[${data.expand.join(", ")}]`);

		const row = await query;
		if (!row?.id) {
			throw new errs.ItemNotFoundError(data.id);
		}

		return row;
	},

	/**
	 * Not for public use: permission to add is assumed to be checked already; the access token only gives the
	 * default user id.
	 *
	 * @param   {Access}   access
	 * @param   {Object}   data
	 * @param   {String}   data.action
	 * @param   {Number}   [data.user_id]
	 * @param   {Number}   [data.object_id]
	 * @param   {Number}   [data.object_type]
	 * @param   {Object}   [data.meta]
	 * @returns {Promise}
	 */
	add: (access, data) => {
		data.user_id ||= access.token.getUserId(1);

		if (!data.action) throw new errs.InternalValidationError("Audit log entry must contain an Action");

		return auditLogModel.query().insert({
			user_id: data.user_id,
			action: data.action,
			object_type: data.object_type || "",
			object_id: data.object_id || 0,
			meta: data.meta || {},
		});
	},
};

export default internalAuditLog;
