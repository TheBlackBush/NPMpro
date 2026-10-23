// Objection Docs:
// http://vincit.github.io/objection.js/

import { Model } from "objection";
import db from "../db.js";
import { convertBoolFieldsToInt, convertIntFieldsToBool } from "../lib/helpers.js";
import AccessList from "./access_list.js";

Model.knex(db());

const boolFields = [
	"npmpro_enabled",
	"npmpro_noindex",
	"npmpro_crowdsec_appsec",
	"npmpro_proxy_request_buffering",
	"npmpro_proxy_response_buffering",
	"npmpro_upstream_compression",
	"npmpro_fancyindex",
];

class Location extends Model {
	$beforeInsert() {
		this.advanced_config ??= "";
	}

	$parseDatabaseJson(json) {
		return convertIntFieldsToBool(super.$parseDatabaseJson(json), boolFields);
	}

	$formatDatabaseJson(json) {
		return super.$formatDatabaseJson(convertBoolFieldsToInt(json, boolFields));
	}

	static tableName = "npmpro_location";

	static get relationMappings() {
		return {
			access_lists: {
				relation: Model.ManyToManyRelation,
				modelClass: AccessList,
				join: {
					from: "npmpro_location.id",
					through: {
						from: "npmpro_proxy_host_access_list.location_id",
						to: "npmpro_proxy_host_access_list.access_list_id",
					},
					to: "access_list.id",
				},
				modify: (qb) => {
					qb.orderBy("npmpro_proxy_host_access_list.position");
				},
			},
		};
	}
}

export default Location;
