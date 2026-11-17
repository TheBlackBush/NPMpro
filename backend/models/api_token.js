import { Model } from "objection";
import db from "../db.js";
import userModel from "./user.js";

Model.knex(db());

const SWITCHES = ["is_admin", "allow_delete", "expiry_audited"];
const TIMES = ["expires_on", "last_used_on", "created_on"];

class ApiToken extends Model {
	// switches are 0/1 on SQLite and MySQL, booleans on Postgres; bigint times come as strings from Postgres
	$parseDatabaseJson(json) {
		const row = super.$parseDatabaseJson(json);
		for (const key of SWITCHES) if (key in row) row[key] = Boolean(Number(row[key]));
		for (const key of TIMES) if (key in row) row[key] = row[key] === null ? null : Number(row[key]);
		return row;
	}

	// the hash never leaves the backend
	$formatJson(json) {
		const { secret_hash: _hash, ...rest } = super.$formatJson(json);
		return rest;
	}

	static tableName = "npmpro_api_token";

	static get relationMappings() {
		return {
			owner: {
				relation: Model.HasOneRelation,
				modelClass: userModel,
				join: { from: "npmpro_api_token.user_id", to: "user.id" },
			},
		};
	}
}

export default ApiToken;
