import { Model } from "objection";
import db from "../db.js";
import { convertBoolFieldsToInt, convertIntFieldsToBool, removeCertificateFields } from "../lib/helpers.js";
import now from "./now_helper.js";

Model.knex(db());

/**
 * What the four host models share. Imports no other model: models/certificate.js imports the host models, so a base
 * that imported it would run a subclass before the base exists.
 */
class HostModel extends Model {
	// the boolean columns, stored as 0 and 1
	static boolFields = [];
	// old columns that stay in the table and are not shown
	static droppedColumns = [];
	// payload fields with no column
	static writeOnlyFields = [];
	// nullable text columns read as "" (the page HTML: MySQL gives TEXT no default)
	static emptyWhenNull = [];

	/** @returns {Object}  a new object each call, the insert defaults */
	static insertDefaults() {
		return {};
	}

	$beforeInsert() {
		this.created_on = now();
		this.modified_on = now();
		for (const [key, value] of Object.entries(this.constructor.insertDefaults())) {
			this[key] ??= value;
		}
	}

	$beforeUpdate() {
		this.modified_on = now();
	}

	$parseDatabaseJson(json) {
		const thisJson = { ...super.$parseDatabaseJson(json) };
		for (const column of this.constructor.droppedColumns) delete thisJson[column];
		for (const column of this.constructor.emptyWhenNull) thisJson[column] ??= "";
		return convertIntFieldsToBool(thisJson, this.constructor.boolFields);
	}

	$formatDatabaseJson(json) {
		const thisJson = convertBoolFieldsToInt(removeCertificateFields(json), this.constructor.boolFields);
		for (const field of this.constructor.writeOnlyFields) delete thisJson[field];
		return super.$formatDatabaseJson(thisJson);
	}
}

export default HostModel;
