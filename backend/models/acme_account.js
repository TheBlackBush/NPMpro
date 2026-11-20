import { Model } from "objection";
import db from "../db.js";
import now from "./now_helper.js";

Model.knex(db());

// One ACME account per CA (directory URL): NPMpro's record next to certbot's account folder
class AcmeAccount extends Model {
	$beforeInsert() {
		this.created_on = now();
		this.modified_on = now();
	}

	$beforeUpdate() {
		this.modified_on = now();
	}

	// the EAB pair never leaves the backend: answers say only whether it is set (spec rule 3)
	$formatJson(json) {
		const { eab_kid: _kid, eab_hmac_key: _key, ...rest } = super.$formatJson(json);
		return rest;
	}

	static tableName = "npmpro_acme_account";
}

export default AcmeAccount;
