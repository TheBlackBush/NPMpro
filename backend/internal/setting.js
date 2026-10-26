import { writeFile } from "node:fs/promises";
import { assertDefaultSiteMeta } from "../lib/default-site.js";
import errs from "../lib/error.js";
import { sanitizeGeoipMeta } from "../lib/monitoring-rules.js";
import { DEDICATED_IDS, HIDDEN_IDS, isDedicatedSettingId } from "../lib/setting-ids.js";
import settingModel from "../models/setting.js";
import internalAuditLog from "./audit-log.js";
import internalNginx from "./nginx.js";
import { sanitizeOidcRow } from "./oidc-setting-rules.js";
import { runtimeExclusive } from "./runtime-queue.js";

// The oidc and geoip rows hold encrypted secrets, which no API returns
const sanitizeRow = (row) => {
	if (row?.id === "oidc") return { ...row, meta: sanitizeOidcRow(row.meta) };
	if (row?.id === "geoip") return { ...row, meta: sanitizeGeoipMeta(row.meta) };
	return row;
};

const internalSetting = {
	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {String}  data.id
	 * @return {Promise}
	 */
	update: async (access, data) => {
		access.canAdmin();
		const refused = () => new errs.ValidationError("This setting has its own endpoint under /api/settings");
		if (isDedicatedSettingId(data.id)) throw refused();

		const existingRow = await internalSetting.get(access, { id: data.id });
		if (DEDICATED_IDS.includes(existingRow.id)) throw refused();

		const merged = { ...existingRow, ...data };
		if (["html", "redirect"].includes(merged.value) && !String(merged.meta?.[merged.value] ?? "").trim()) {
			throw new errs.ValidationError(`meta.${merged.value} is required for ${merged.value}`);
		}
		if (merged.id === "default-site") assertDefaultSiteMeta(merged.meta ?? {});

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
				await writeFile("/data/public/html/index.html", row.meta.html, { encoding: "utf8" });
			}

			// in the runtime settings queue, like the host configs: a runtime save's nginx -t never sees it half written
			await runtimeExclusive(async () => {
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
			});
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
		if (!row?.id || HIDDEN_IDS.includes(row.id)) {
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
		return rows.filter((row) => !HIDDEN_IDS.includes(row.id)).map(sanitizeRow);
	},
};

export default internalSetting;
