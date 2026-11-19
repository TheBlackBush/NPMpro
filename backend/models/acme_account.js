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

	static tableName = "npmpro_acme_account";
}

export default AcmeAccount;
