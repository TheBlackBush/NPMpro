import { Model } from "objection";
import Certificate from "./certificate.js";
import HostModel from "./host-model.js";
import User from "./user.js";

class RedirectionHost extends HostModel {
	static boolFields = [
		"enabled",
		"preserve_path",
		"ssl_forced",
		"hsts_enabled",
		"hsts_subdomains",
		"npmpro_http3_support",
		"npmpro_nginx_online",
		"npmpro_mtls_verify_client_optional",
	];

	static droppedColumns = ["is_deleted", "meta", "block_exploits", "http2_support"];

	static insertDefaults() {
		return { domain_names: [], meta: {}, advanced_config: "", npmpro_nginx_err: "" };
	}

	static tableName = "redirection_host";

	static jsonAttributes = ["domain_names", "meta"];

	static get relationMappings() {
		return {
			owner: {
				relation: Model.HasOneRelation,
				modelClass: User,
				join: {
					from: "redirection_host.owner_user_id",
					to: "user.id",
				},
			},
			certificate: {
				relation: Model.HasOneRelation,
				modelClass: Certificate,
				join: {
					from: "redirection_host.certificate_id",
					to: "certificate.id",
				},
			},
		};
	}
}

export default RedirectionHost;
