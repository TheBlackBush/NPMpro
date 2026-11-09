// Objection Docs:
// http://vincit.github.io/objection.js/

import { Model } from "objection";
import Certificate from "./certificate.js";
import HostModel from "./host-model.js";
import User from "./user.js";

class Stream extends HostModel {
	static boolFields = [
		"enabled",
		"tcp_forwarding",
		"udp_forwarding",
		"npmpro_proxy_tls",
		"npmpro_nginx_online",
		"npmpro_mtls_verify_client_optional",
	];

	static droppedColumns = ["is_deleted", "meta"];

	static writeOnlyFields = ["domain_names"];

	static insertDefaults() {
		return { meta: {}, npmpro_advanced_config: "", npmpro_nginx_err: "" };
	}

	static tableName = "stream";

	static jsonAttributes = ["meta"];

	static get relationMappings() {
		return {
			owner: {
				relation: Model.HasOneRelation,
				modelClass: User,
				join: {
					from: "stream.owner_user_id",
					to: "user.id",
				},
			},
			certificate: {
				relation: Model.HasOneRelation,
				modelClass: Certificate,
				join: {
					from: "stream.certificate_id",
					to: "certificate.id",
				},
			},
		};
	}
}

export default Stream;
