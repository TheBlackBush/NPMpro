import { Model } from "objection";
import db from "../db.js";
import ddnsRecordModel from "./ddns_record.js";
import now from "./now_helper.js";

Model.knex(db());

class DdnsHistory extends Model {
	$beforeInsert() {
		this.created_on = now();
	}

	static tableName = "npmpro_ddns_history";

	// read when a query runs, so the import cycle with ddns_record.js is safe
	static get relationMappings() {
		return {
			record: {
				relation: Model.BelongsToOneRelation,
				modelClass: ddnsRecordModel,
				join: {
					from: "npmpro_ddns_history.ddns_record_id",
					to: "npmpro_ddns_record.id",
				},
			},
		};
	}
}

export default DdnsHistory;
