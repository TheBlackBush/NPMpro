import { Model } from "objection";
import db from "../db.js";

Model.knex(db());

// `data` is JSON text that the notify store parses, so there are no jsonAttributes
class NotificationState extends Model {
	static tableName = "npmpro_notification_state";
}

export default NotificationState;
