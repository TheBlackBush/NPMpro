import { writeFile } from "node:fs/promises";
import errs from "../lib/error.js";
import settingModel from "../models/setting.js";
import internalAuditLog from "./audit-log.js";
import internalNginx from "./nginx.js";
import { sanitizeOidcRow } from "./oidc-setting-rules.js";

// The oidc row holds the encrypted client secret, which no API returns
const sanitizeRow = (row) => (row?.id === "oidc" ? { ...row, meta: sanitizeOidcRow(row.meta) } : row);

const internalSetting = {
	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {String}  data.id
	 * @return {Promise}
	 */
	update: async (access, data) => {
		access.canAdmin();
		const oidcRefused = () => new errs.ValidationError("Use /api/settings/oidc to change the OIDC settings");
		if (String(data.id).trim().toLowerCase() === "oidc") throw oidcRefused();

		const existingRow = await internalSetting.get(access, { id: data.id });
		if (existingRow.id === "oidc") throw oidcRefused();

		const merged = { ...existingRow, ...data };
		if (["html", "redirect"].includes(merged.value) && !merged.meta?.[merged.value]) {
			throw new errs.ValidationError(`meta.${merged.value} is required for ${merged.value}`);
		}

		await settingModel.query().where({ id: data.id }).patch(data);

		const row = await internalSetting.get(access, {
			id: data.id,
		});

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "setting",
			meta: row,
		});
		if (row.id === "default-site") {
			// write the html if we need to
			if (row.value === "html") {
				await writeFile("/data/html/index.html", row.meta.html, { encoding: "utf8" });
			}

			try {
				await internalNginx.deleteConfig("default");
				await internalNginx.generateConfig("default", row);
				await internalNginx.test();
				await internalNginx.reload();
			} catch (err) {
				await internalNginx.deleteConfig("default");
				await internalNginx.test();
				await internalNginx.reload();
				throw new errs.ValidationError("Could not reconfigure Nginx. Please check logs.", undefined, {
					cause: err,
				});
			}
		}
		return row;
	},

	/**
	 * @param  {Access}   access
	 * @param  {Object}   data
	 * @param  {String}   data.id
	 * @return {Promise}
	 */
	get: async (access, data) => {
		access.canAdmin();

		const row = await settingModel.query().where("id", data.id).first();
		if (!row?.id) {
			throw new errs.ItemNotFoundError(data.id);
		}

		return sanitizeRow(row);
	},

	/**
	 * All settings
	 *
	 * @param   {Access}  access
	 * @returns {Promise}
	 */
	getAll: async (access) => {
		access.canAdmin();
		const rows = await settingModel.query().orderBy("description", "ASC");
		return rows.map(sanitizeRow);
	},
};

export default internalSetting;
