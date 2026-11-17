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
	 * @param   {?Access}  access  null when data.user_id is set
	 * @param   {Object}   data
	 * @param   {String}   data.action
	 * @param   {Number}   [data.user_id]
	 * @param   {Number}   [data.object_id]
	 * @param   {Number}   [data.object_type]
	 * @param   {Object}   [data.meta]
	 * @param   {Object}   [data.api_token]  { id, name } of the API token that acted; default: the token of access
	 * @returns {Promise}
	 */
	add: (access, data) => {
		const { api_token: given, ...entry } = data;
		entry.user_id ||= access.token.getUserId(1);

		if (!entry.action) throw new errs.InternalValidationError("Audit log entry must contain an Action");

		// the API token of the request (or the one given), so the log shows which token acted
		const token = given ?? access?.apiToken ?? null;
		return auditLogModel.query().insert({
			user_id: entry.user_id,
			action: entry.action,
			object_type: entry.object_type || "",
			object_id: entry.object_id || 0,
			meta: entry.meta || {},
			npmpro_api_token_id: token?.id ?? null,
			npmpro_api_token_name: token?.name ?? null,
		});
	},
};

export default internalAuditLog;
