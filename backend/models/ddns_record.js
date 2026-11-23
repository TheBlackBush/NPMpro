import { Model } from "objection";
import db from "../db.js";
import ddnsHistoryModel from "./ddns_history.js";
import dnsCredentialModel from "./dns_credential.js";
import now from "./now_helper.js";
import userModel from "./user.js";

Model.knex(db());

class DdnsRecord extends Model {
	static insertDefaults() {
		return { kind: "address" };
	}

	$beforeInsert() {
		for (const [key, value] of Object.entries(DdnsRecord.insertDefaults())) this[key] ??= value;
		this.created_on = now();
		this.modified_on = now();
	}

	$beforeUpdate() {
		this.modified_on = now();
	}

	// the switch is 0/1 on SQLite and MySQL, a boolean on Postgres
	$parseDatabaseJson(json) {
		const row = super.$parseDatabaseJson(json);
		if ("enabled" in row) row.enabled = Boolean(Number(row.enabled));
		return row;
	}

	// the sealed custom provider URL never leaves the backend
	$formatJson(json) {
		const { secret: _secret, ...rest } = super.$formatJson(json);
		return rest;
	}

	static tableName = "npmpro_ddns_record";

	static get jsonAttributes() {
		return ["meta"];
	}

	static get relationMappings() {
		return {
			credential: {
				relation: Model.BelongsToOneRelation,
				modelClass: dnsCredentialModel,
				join: {
					from: "npmpro_ddns_record.dns_credential_id",
					to: "npmpro_dns_credential.id",
				},
			},
			owner: {
				relation: Model.HasOneRelation,
				modelClass: userModel,
				join: {
					from: "npmpro_ddns_record.owner_user_id",
					to: "user.id",
				},
			},
			history: {
				relation: Model.HasManyRelation,
				modelClass: ddnsHistoryModel,
				join: {
					from: "npmpro_ddns_record.id",
					to: "npmpro_ddns_history.ddns_record_id",
				},
			},
		};
	}
}

export default DdnsRecord;
