import { Model } from "objection";
import db from "../db.js";
import { convertBoolFieldsToInt, convertIntFieldsToBool } from "../lib/helpers.js";
import { publicUserJson } from "../lib/user-json.js";
import now from "./now_helper.js";
import UserPermission from "./user_permission.js";

Model.knex(db());

const boolFields = ["is_disabled"];

class User extends Model {
	$beforeInsert() {
		this.created_on = now();
		this.modified_on = now();

		this.roles ??= [];
	}

	$beforeUpdate() {
		this.modified_on = now();
	}

	$parseDatabaseJson(json) {
		const { is_deleted, nickname, ...thisJson } = super.$parseDatabaseJson(json);
		return convertIntFieldsToBool(thisJson, boolFields);
	}

	$formatDatabaseJson(json) {
		const thisJson = convertBoolFieldsToInt(json, boolFields);
		return super.$formatDatabaseJson(thisJson);
	}

	// every API answer (list, single user, me, an audit meta that holds a user) leaves out the OIDC issuer and subject
	$formatJson(json) {
		return publicUserJson(super.$formatJson(json));
	}

	static tableName = "user";

	static jsonAttributes = ["roles"];

	static get relationMappings() {
		return {
			permissions: {
				relation: Model.HasOneRelation,
				modelClass: UserPermission,
				join: {
					from: "user.id",
					to: "user_permission.user_id",
				},
			},
		};
	}
}

export default User;
