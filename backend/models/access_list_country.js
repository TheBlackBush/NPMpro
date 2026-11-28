import { Model } from "objection";
import db from "../db.js";
import now from "./now_helper.js";

Model.knex(db());

class AccessListCountry extends Model {
	$beforeInsert() {
		this.created_on = now();
		this.modified_on = now();

		this.npmpro_comment ??= "";
	}

	$beforeUpdate() {
		this.modified_on = now();
	}

	static tableName = "npmpro_access_list_country";
}

export default AccessListCountry;
