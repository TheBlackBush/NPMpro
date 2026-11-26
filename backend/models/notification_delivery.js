import { Model } from "objection";
import db from "../db.js";
import now from "./now_helper.js";

Model.knex(db());

// `payload` is JSON text that the notify store parses, so there are no jsonAttributes
class NotificationDelivery extends Model {
	$beforeInsert() {
		this.created_on = now();
		this.modified_on = now();
	}

	$beforeUpdate() {
		this.modified_on = now();
	}

	// the queued payload (a mail input or an envelope) never leaves the backend through the API
	$formatJson(json) {
		const { payload: _payload, ...rest } = super.$formatJson(json);
		return rest;
	}

	static tableName = "npmpro_notification_delivery";
}

export default NotificationDelivery;
