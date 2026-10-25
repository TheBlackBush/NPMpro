import assert from "node:assert/strict";
import { it } from "node:test";
import { addMonitoringFlag, createMonitoringAvailable } from "../lib/monitoring-available.js";

const API_URL = "API_URL=http://crowdsec:8080";
const BOUNCER = ["ENABLED=true", API_URL, "API_KEY=bouncer-key"].join("\n");
const DISABLED = ["ENABLED=false", API_URL, "API_KEY=bouncer-key"].join("\n");
const NO_KEY = ["ENABLED=true", API_URL].join("\n");

const available = ({ traffic = false, conf = "", configFails = false, confFails = false } = {}) => {
	const errors = [];
	const check = createMonitoringAvailable({
		getConfig: () =>
			configFails
				? Promise.reject(new Error("settings table missing"))
				: Promise.resolve({ values: { traffic_enabled: traffic } }),
		readConf: () => (confFails ? Promise.reject(new Error("EACCES")) : Promise.resolve(conf)),
		log: { error: (message) => errors.push(message) },
	});
	return { check, errors };
};

it("is true while traffic statistics are on or the CrowdSec bouncer is configured", async () => {
	assert.equal(await available({ traffic: true }).check(), true);
	assert.equal(await available({ conf: BOUNCER }).check(), true);
	assert.equal(await available({ traffic: true, conf: BOUNCER }).check(), true);
});

it("is false with traffic statistics off and no usable bouncer config", async () => {
	assert.equal(await available().check(), false);
	assert.equal(await available({ conf: DISABLED }).check(), false);
	assert.equal(await available({ conf: NO_KEY }).check(), false);
});

it("counts a source that cannot be read as off and logs it", async () => {
	const settings = available({ configFails: true, conf: BOUNCER });
	assert.equal(await settings.check(), true);
	assert.equal(settings.errors.length, 1);
	const conf = available({ confFails: true });
	assert.equal(await conf.check(), false);
	assert.deepEqual(conf.errors, ["Could not read the CrowdSec config: EACCES"]);
});

it("adds monitoring to the requesting user only, false for non-admins", async () => {
	let calls = 0;
	const yes = () => {
		calls += 1;
		return Promise.resolve(true);
	};
	const admin = await addMonitoringFlag({ id: 1, roles: ["admin"] }, 1, yes);
	assert.equal(admin.monitoring, true);
	const plain = await addMonitoringFlag({ id: 2, roles: [] }, 2, yes);
	assert.equal(plain.monitoring, false);
	const other = await addMonitoringFlag({ id: 3, roles: ["admin"] }, 1, yes);
	assert.equal(Object.hasOwn(other, "monitoring"), false);
	assert.equal(calls, 1);
});
