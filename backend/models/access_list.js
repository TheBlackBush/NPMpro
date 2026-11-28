import { Model } from "objection";
import db from "../db.js";
import { convertBoolFieldsToInt, convertIntFieldsToBool } from "../lib/helpers.js";
import AccessListAuth from "./access_list_auth.js";
import AccessListClient from "./access_list_client.js";
import AccessListCountry from "./access_list_country.js";
import now from "./now_helper.js";
import ProxyHost from "./proxy_host.js";
import User from "./user.js";

Model.knex(db());

const boolFields = ["satisfy_any", "pass_auth", "npmpro_geo_drop"];

class AccessList extends Model {
	$beforeInsert() {
		this.created_on = now();
		this.modified_on = now();

		this.meta ??= {};
		this.npmpro_denied_page ??= "global";
		this.npmpro_geo_mode ??= "off";
		this.npmpro_geo_unknown ??= "auto";
		this.npmpro_geo_drop ??= false;
	}

	$beforeUpdate() {
		this.modified_on = now();
	}

	$parseDatabaseJson(json) {
		const { is_deleted, meta, ...thisJson } = super.$parseDatabaseJson(json);
		thisJson.proxy_host_count &&= Number(thisJson.proxy_host_count);
		if (Object.hasOwn(thisJson, "npmpro_denied_page_html")) thisJson.npmpro_denied_page_html ??= "";
		return convertIntFieldsToBool(thisJson, boolFields);
	}

	$formatDatabaseJson(json) {
		const thisJson = convertBoolFieldsToInt(json, boolFields);
		return super.$formatDatabaseJson(thisJson);
	}

	static tableName = "access_list";

	static jsonAttributes = ["meta"];

	static get relationMappings() {
		return {
			owner: {
				relation: Model.HasOneRelation,
				modelClass: User,
				join: {
					from: "access_list.owner_user_id",
					to: "user.id",
				},
			},
			items: {
				relation: Model.HasManyRelation,
				modelClass: AccessListAuth,
				join: {
					from: "access_list.id",
					to: "access_list_auth.access_list_id",
				},
				modify: (qb) => {
					qb.orderBy("access_list_auth.id");
				},
			},
			clients: {
				relation: Model.HasManyRelation,
				modelClass: AccessListClient,
				join: {
					from: "access_list.id",
					to: "access_list_client.access_list_id",
				},
				modify: (qb) => {
					qb.orderBy("access_list_client.id");
				},
			},
			npmpro_countries: {
				relation: Model.HasManyRelation,
				modelClass: AccessListCountry,
				join: {
					from: "access_list.id",
					to: "npmpro_access_list_country.access_list_id",
				},
				modify: (qb) => {
					qb.orderBy("npmpro_access_list_country.country");
				},
			},
			proxy_hosts: {
				relation: Model.ManyToManyRelation,
				modelClass: ProxyHost,
				join: {
					from: "access_list.id",
					through: {
						from: "npmpro_proxy_host_access_list.access_list_id",
						to: "npmpro_proxy_host_access_list.proxy_host_id",
					},
					to: "proxy_host.id",
				},
			},
		};
	}
}

export default AccessList;
