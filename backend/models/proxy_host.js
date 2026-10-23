// Objection Docs:
// http://vincit.github.io/objection.js/

import { Model } from "objection";
import db from "../db.js";
import { convertBoolFieldsToInt, convertIntFieldsToBool, removeCertificateFields } from "../lib/helpers.js";
import AccessList from "./access_list.js";
import Certificate from "./certificate.js";
import Location from "./location.js";
import now from "./now_helper.js";
import User from "./user.js";

Model.knex(db());

const boolFields = [
	"ssl_forced",
	"npmpro_http3_support",
	"enabled",
	"hsts_enabled",
	"hsts_subdomains",
	"npmpro_noindex",
	"npmpro_crowdsec_appsec",
	"npmpro_proxy_request_buffering",
	"npmpro_proxy_response_buffering",
	"npmpro_upstream_compression",
	"npmpro_fancyindex",
	"npmpro_nginx_online",
	"npmpro_mtls_verify_client_optional",
	"npmpro_mtls_bypass_auth_request",
];

class ProxyHost extends Model {
	$beforeInsert() {
		this.created_on = now();
		this.modified_on = now();

		// Default for domain_names
		this.domain_names ??= [];

		// Default for meta
		this.meta ??= {};
		this.advanced_config ??= "";
		this.npmpro_location_config ??= "";
		this.npmpro_nginx_err ??= "";

		// Default for access list type
		this.npmpro_access_list_type ??= "public";
	}

	$beforeUpdate() {
		this.modified_on = now();
	}

	$parseDatabaseJson(json) {
		const {
			is_deleted,
			meta,
			access_list_id,
			caching_enabled,
			block_exploits,
			allow_websocket_upgrade,
			http2_support,
			trust_forwarded_proto,
			locations,
			...thisJson
		} = super.$parseDatabaseJson(json);
		return convertIntFieldsToBool(thisJson, boolFields);
	}

	$formatDatabaseJson(json) {
		const { npmpro_access_list_ids, ...thisJson } = convertBoolFieldsToInt(
			removeCertificateFields(json),
			boolFields,
		);
		return super.$formatDatabaseJson(thisJson);
	}

	static tableName = "proxy_host";

	static jsonAttributes = ["domain_names", "meta"];

	static get relationMappings() {
		return {
			owner: {
				relation: Model.HasOneRelation,
				modelClass: User,
				join: {
					from: "proxy_host.owner_user_id",
					to: "user.id",
				},
			},
			access_lists: {
				relation: Model.ManyToManyRelation,
				modelClass: AccessList,
				join: {
					from: "proxy_host.id",
					through: {
						from: "npmpro_proxy_host_access_list.proxy_host_id",
						to: "npmpro_proxy_host_access_list.access_list_id",
					},
					to: "access_list.id",
				},
				modify: (qb) => {
					qb.where("npmpro_proxy_host_access_list.location_id", 0).orderBy(
						"npmpro_proxy_host_access_list.position",
					);
				},
			},
			certificate: {
				relation: Model.HasOneRelation,
				modelClass: Certificate,
				join: {
					from: "proxy_host.certificate_id",
					to: "certificate.id",
				},
			},
			locations: {
				relation: Model.HasManyRelation,
				modelClass: Location,
				join: {
					from: "proxy_host.id",
					to: "npmpro_location.proxy_host_id",
				},
				modify: (qb) => {
					qb.orderBy("npmpro_location.id");
				},
			},
		};
	}
}

export default ProxyHost;
