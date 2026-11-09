// Objection Docs:
// http://vincit.github.io/objection.js/

import { Model } from "objection";
import Certificate from "./certificate.js";
import HostModel from "./host-model.js";
import User from "./user.js";

class DeadHost extends HostModel {
	static boolFields = [
		"ssl_forced",
		"npmpro_http3_support",
		"enabled",
		"hsts_enabled",
		"hsts_subdomains",
		"npmpro_nginx_online",
		"npmpro_mtls_verify_client_optional",
	];

	static droppedColumns = ["is_deleted", "meta", "http2_support"];

	static insertDefaults() {
		return { domain_names: [], meta: {}, advanced_config: "", npmpro_nginx_err: "" };
	}

	static tableName = "dead_host";

	static jsonAttributes = ["domain_names", "meta"];

	static get relationMappings() {
		return {
			owner: {
				relation: Model.HasOneRelation,
				modelClass: User,
				join: {
					from: "dead_host.owner_user_id",
					to: "user.id",
				},
			},
			certificate: {
				relation: Model.HasOneRelation,
				modelClass: Certificate,
				join: {
					from: "dead_host.certificate_id",
					to: "certificate.id",
				},
			},
		};
	}
}

export default DeadHost;
