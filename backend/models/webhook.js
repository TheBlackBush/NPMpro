import { Model } from "objection";
import db from "../db.js";
import now from "./now_helper.js";

Model.knex(db());

const SWITCHES = ["enabled", "verify_tls"];

class Webhook extends Model {
	$beforeInsert() {
		this.created_on = now();
		this.modified_on = now();
	}

	$beforeUpdate() {
		this.modified_on = now();
	}

	// switches are 0/1 on SQLite and MySQL, booleans on Postgres; events are JSON text
	$parseDatabaseJson(json) {
		const row = super.$parseDatabaseJson(json);
		for (const key of SWITCHES) if (key in row) row[key] = Boolean(Number(row[key]));
		if (typeof row.events === "string") row.events = JSON.parse(row.events);
		return row;
	}

	$formatDatabaseJson(json) {
		const row = super.$formatDatabaseJson(json);
		if (Array.isArray(row.events)) row.events = JSON.stringify(row.events);
		return row;
	}

	// the sealed URL and secrets never leave the backend through the API
	$formatJson(json) {
		const { url: _url, secret: _secret, previous_secret: _previous, ...rest } = super.$formatJson(json);
		return rest;
	}

	static tableName = "npmpro_webhook";
}

export default Webhook;
