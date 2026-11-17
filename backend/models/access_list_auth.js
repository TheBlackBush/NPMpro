import { Model } from "objection";
import db from "../db.js";
import accessListModel from "./access_list.js";
import now from "./now_helper.js";

Model.knex(db());

class AccessListAuth extends Model {
	$beforeInsert() {
		this.created_on = now();
		this.modified_on = now();

		this.meta ??= {};
	}

	$beforeUpdate() {
		this.modified_on = now();
	}

	$parseDatabaseJson(json) {
		const { meta, ...thisJson } = super.$parseDatabaseJson(json);
		return thisJson;
	}

	// the bcrypt hash is write-only: API answers never carry it (htpasswd files and backups read the stored row)
	$formatJson(json) {
		const { password: _hash, ...thisJson } = super.$formatJson(json);
		return thisJson;
	}

	static tableName = "access_list_auth";

	static jsonAttributes = ["meta"];

	static get relationMappings() {
		return {
			access_list: {
				relation: Model.HasOneRelation,
				modelClass: accessListModel,
				join: {
					from: "access_list_auth.access_list_id",
					to: "access_list.id",
				},
			},
		};
	}
}

export default AccessListAuth;
