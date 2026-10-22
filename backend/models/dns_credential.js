// Objection Docs:
// http://vincit.github.io/objection.js/

import { Model } from "objection";
import db from "../db.js";
import certificateModel from "./certificate.js";
import now from "./now_helper.js";
import userModel from "./user.js";

Model.knex(db());

class DnsCredential extends Model {
	$beforeInsert() {
		this.created_on = now();
		this.modified_on = now();
	}

	$beforeUpdate() {
		this.modified_on = now();
	}

	// the encrypted values never leave the backend
	$formatJson(json) {
		const { values, ...thisJson } = super.$formatJson(json);
		return thisJson;
	}

	static tableName = "npmplus_dns_credential";

	static get relationMappings() {
		return {
			owner: {
				relation: Model.HasOneRelation,
				modelClass: userModel,
				join: {
					from: "npmplus_dns_credential.owner_user_id",
					to: "user.id",
				},
			},
			certificates: {
				relation: Model.HasManyRelation,
				modelClass: certificateModel,
				join: {
					from: "npmplus_dns_credential.id",
					to: "certificate.npmplus_dns_credential_id",
				},
			},
		};
	}
}

export default DnsCredential;
