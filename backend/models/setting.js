import { Model } from "objection";
import db from "../db.js";

Model.knex(db());

class Setting extends Model {
	$beforeInsert() {
		this.meta ??= {};
	}

	static tableName = "setting";

	static jsonAttributes = ["meta"];
}

export default Setting;
