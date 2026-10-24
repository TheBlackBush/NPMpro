// Objection Docs:
// http://vincit.github.io/objection.js/

import { Model } from "objection";
import db from "../db.js";

Model.knex(db());

class TrafficMinute extends Model {
	static tableName = "traffic_minute";
}

class TrafficHour extends Model {
	static tableName = "traffic_hour";
}

class TrafficCountryHour extends Model {
	static tableName = "traffic_country_hour";
}

class TrafficAsnHour extends Model {
	static tableName = "traffic_asn_hour";
}

class TrafficIpHour extends Model {
	static tableName = "traffic_ip_hour";
}

export { TrafficAsnHour, TrafficCountryHour, TrafficHour, TrafficIpHour, TrafficMinute };
