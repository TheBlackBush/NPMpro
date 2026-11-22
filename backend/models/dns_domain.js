import { Model } from "objection";
import db from "../db.js";
import dnsCredentialModel from "./dns_credential.js";
import now from "./now_helper.js";

Model.knex(db());

class DnsDomain extends Model {
	$beforeInsert() {
		this.created_on = now();
		this.modified_on = now();
	}

	$beforeUpdate() {
		this.modified_on = now();
	}

	static tableName = "npmpro_dns_domain";

	// read when a query runs, so the import cycle with dns_credential.js is safe
	static get relationMappings() {
		return {
			credential: {
				relation: Model.BelongsToOneRelation,
				modelClass: dnsCredentialModel,
				join: {
					from: "npmpro_dns_domain.dns_credential_id",
					to: "npmpro_dns_credential.id",
				},
			},
		};
	}
}

export default DnsDomain;
