import { Model } from "objection";
import db from "../db.js";

Model.knex(db());

// the times are read through lib/notify/db-time.js (msOfDbTime), so there is no parsing here
class PasswordToken extends Model {
	static tableName = "npmpro_password_token";
}

export default PasswordToken;
