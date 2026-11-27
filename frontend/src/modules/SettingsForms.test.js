import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	certificatesValidate,
	defaultSiteHiddenFields,
	defaultSitePayload,
	defaultSiteValidate,
	defaultSiteValues,
	forwardAuthValidate,
	geoipRequest,
	geoipValidate,
	geoipValues,
	isNginxTime,
	lockedIn,
	monitoringConfirmKey,
	monitoringRequest,
	monitoringValidate,
	monitoringValues,
	networkValidate,
	nginxToApi,
	nginxToForm,
	nginxValidate,
	parseCpuList,
	toggleDbipEdition,
	toggleEdition,
	unlockedErrors,
} from "./SettingsForms.js";
import { createValidations } from "./ValidationRules.js";

const rules = createValidations(createIntl({ locale: "en", messages: en }));
const RANGE = (min, max) => `Enter a whole number from ${min} to ${max}`;

it("reads env locks of camelCase keys and drops the messages of locked fields", () => {
	const isLocked = lockedIn(["account_id", "retention_days"]);
	assert.equal(isLocked("accountId"), true);
	assert.equal(isLocked("retentionDays"), true);
	assert.equal(isLocked("licenseKey"), false);
	assert.equal(lockedIn(undefined)("accountId"), false);
	assert.deepEqual(unlockedErrors({ accountId: "A", licenseKey: "B" }, isLocked), { licenseKey: "B" });
	assert.deepEqual(unlockedErrors(undefined, isLocked), {});
});

it("default site: starting values with the status as text", () => {
	assert.deepEqual(defaultSiteValues({ value: "html", meta: { html: "<p>", status: 503, redirect: "" } }), {
		value: "html",
		redirect: "",
		html: "<p>",
		status: "503",
	});
	assert.deepEqual(defaultSiteValues({ value: "congratulations", meta: {} }), {
		value: "congratulations",
		redirect: "",
		html: "",
		status: "",
	});
});

it("default site: the same errors as the Formik validate, only for the chosen option", () => {
	const validate = defaultSiteValidate(rules);
	const base = { value: "redirect", redirect: "", html: "", status: "" };
	assert.deepEqual(validate(base), { redirect: "This is required" });
	assert.deepEqual(validate({ ...base, redirect: `https://${"a".repeat(250)}` }), {
		redirect: "Maximum length is 255 characters",
	});
	assert.deepEqual(validate({ ...base, redirect: "example.com" }), {
		redirect: "Enter a full http:// or https:// URL, without spaces, quotes or ; { } #",
	});
	assert.deepEqual(validate({ ...base, redirect: " https://example.com/a " }), {});
	const html = { ...base, value: "html" };
	assert.deepEqual(validate(html), { html: "This is required" });
	assert.deepEqual(validate({ ...html, html: "<p>", status: "200" }), {
		status: "Enter a status code from 400 to 599, or leave it empty for 200",
	});
	assert.deepEqual(validate({ ...html, html: "<p>", status: "503.5" }), {
		status: "Enter a status code from 400 to 599, or leave it empty for 200",
	});
	assert.deepEqual(validate({ ...html, html: "<p>", status: "503" }), {});
	assert.deepEqual(validate({ ...base, value: "404", redirect: "bad" }), {});
});

it("default site: names the fields an option hides", () => {
	assert.deepEqual(defaultSiteHiddenFields("redirect"), ["html", "status"]);
	assert.deepEqual(defaultSiteHiddenFields("html"), ["redirect"]);
	assert.deepEqual(defaultSiteHiddenFields("404"), ["redirect", "html", "status"]);
});

it("default site: sends the chosen option with its fields and keeps the others' saved values", () => {
	const data = { value: "html", meta: { redirect: "https://old", html: "<old>", status: 503 } };
	assert.deepEqual(defaultSitePayload({ value: "redirect", redirect: " https://new ", html: "", status: "" }, data), {
		value: "redirect",
		meta: { redirect: "https://new", html: "<old>", status: 503 },
	});
	assert.deepEqual(defaultSitePayload({ value: "html", redirect: "", html: "<new>", status: "" }, data), {
		value: "html",
		meta: { redirect: "https://old", html: "<new>", status: undefined },
	});
	assert.deepEqual(defaultSitePayload({ value: "html", redirect: "", html: "<new>", status: "404" }, data).meta, {
		redirect: "https://old",
		html: "<new>",
		status: 404,
	});
	assert.deepEqual(defaultSitePayload({ value: "444", redirect: "x", html: "y", status: "" }, data), {
		value: "444",
		meta: { redirect: "https://old", html: "<old>", status: 503 },
	});
});

it("certificates: the same errors as the Formik validate", () => {
	const validate = certificatesValidate(rules);
	const ok = { renewalInterval: "24", warningDays: "14", echRotationInterval: "1", profile: " tlsserver " };
	assert.deepEqual(validate(ok), {});
	assert.deepEqual(validate({ renewalInterval: "0", warningDays: "61", echRotationInterval: "25", profile: "a b" }), {
		renewalInterval: RANGE(1, 499),
		warningDays: RANGE(1, 60),
		echRotationInterval: RANGE(1, 24),
		profile: "Up to 64 letters, digits, dots, dashes or underscores",
	});
	assert.deepEqual(validate({ ...ok, renewalInterval: "1.5" }), { renewalInterval: RANGE(1, 499) });
	assert.deepEqual(validate({ ...ok, renewalInterval: "" }), { renewalInterval: RANGE(1, 499) });
	for (const warningDays of ["1", "60"]) assert.deepEqual(validate({ ...ok, warningDays }), {});
	for (const warningDays of ["0", "61", "", "1.5"]) {
		assert.deepEqual(validate({ ...ok, warningDays }), { warningDays: RANGE(1, 60) });
	}
	assert.deepEqual(validate({ ...ok, profile: "x".repeat(65) }), {
		profile: "Up to 64 letters, digits, dots, dashes or underscores",
	});
});

it("nginx: reads time values as nginx does", () => {
	for (const value of ["0", "30", "30s", "1h30m", "1y2M3w4d5h6m7s8ms"]) assert.equal(isNginxTime(value), true, value);
	for (const value of ["", "30x", "1m1h", "1s1s", "10 s", "30s5", `${"1".repeat(32)}s`]) {
		assert.equal(isNginxTime(value), false, value);
	}
});

it("nginx: the same errors as the Formik validate", () => {
	const validate = nginxValidate(rules);
	assert.deepEqual(validate({ workerConnections: "1024", workerShutdownTimeout: " 10s " }), {});
	assert.deepEqual(validate({ workerConnections: "63", workerShutdownTimeout: "10 x" }), {
		workerConnections: RANGE(64, 65535),
		workerShutdownTimeout: "Enter 0 or a time value like 30s, 10m or 1h",
	});
	assert.deepEqual(validate({ workerConnections: "65536", workerShutdownTimeout: null }), {
		workerConnections: RANGE(64, 65535),
		workerShutdownTimeout: "Enter 0 or a time value like 30s, 10m or 1h",
	});
});

it("nginx: the resolver values go to the form and back", () => {
	const base = { workerProcesses: 4, workerConnections: 512, workerShutdownTimeout: "1h", cpuAffinity: "off" };
	const form = nginxToForm({
		...base,
		resolverAddresses: ["1.1.1.1"],
		resolverHosts: false,
		resolverIpv6: true,
		resolverValid: "30s",
	});
	assert.deepEqual(form.resolverAddresses, ["1.1.1.1"]);
	assert.equal(form.resolverHosts, false);
	assert.equal(form.resolverIpv6, true);
	assert.equal(form.resolverValid, "30s");
	const api = nginxToApi(form);
	assert.deepEqual(api.resolverAddresses, ["1.1.1.1"]);
	assert.equal(api.resolverValid, "30s");
	assert.deepEqual(nginxToForm(base).resolverAddresses, []);
	assert.equal(nginxToForm(base).resolverValid, "");
});

it("nginx: the CPU pinning is a mode and a list, and goes back to one value", () => {
	const base = { workerProcesses: 4, workerConnections: 512, workerShutdownTimeout: "1h", tls12: true };
	for (const [cpuAffinity, mode, list] of [
		["off", "off", ""],
		["auto", "auto", ""],
		["16-19", "custom", "16-19"],
		["16,18,20", "custom", "16,18,20"],
	]) {
		const form = nginxToForm({ ...base, cpuAffinity });
		assert.equal(form.cpuAffinityMode, mode);
		assert.equal(form.cpuAffinityList, list);
		const api = nginxToApi(form);
		assert.equal(api.cpuAffinity, cpuAffinity);
		assert.equal("cpuAffinityMode" in api || "cpuAffinityList" in api, false);
		assert.equal(api.workerConnections, 512);
	}
	assert.equal(
		nginxToApi({
			...nginxToForm({ ...base, cpuAffinity: "off" }),
			cpuAffinityMode: "custom",
			cpuAffinityList: " 1-2 ",
		}).cpuAffinity,
		"1-2",
	);
	assert.equal(nginxToApi({ workerConnections: "512", cpuAffinityMode: "custom" }).cpuAffinity, "");
});

it("nginx: the CPU list needs the syntax and CPUs the container may use, unless it is the saved value", () => {
	const validate = nginxValidate(rules);
	const form = { workerConnections: "512", workerShutdownTimeout: "1h", cpuAffinityMode: "custom" };
	const data = { cpusAllowed: "16-23", cpuAffinity: "off", locked: [] };
	assert.deepEqual(parseCpuList("0-3,8"), new Set([0, 1, 2, 3, 8]));
	assert.equal(parseCpuList("3-1"), null);
	assert.deepEqual(validate({ ...form, cpuAffinityList: "16-19" }, data), {});
	assert.deepEqual(validate({ ...form, cpuAffinityList: "a" }, data), {
		cpuAffinityList: "Use CPU numbers and ranges such as 16-19 or 16,18,20.",
	});
	assert.deepEqual(validate({ ...form, cpuAffinityList: "" }, data), {
		cpuAffinityList: "Use CPU numbers and ranges such as 16-19 or 16,18,20.",
	});
	assert.deepEqual(validate({ ...form, cpuAffinityList: "0-3" }, data), {
		cpuAffinityList: "CPUs 0-3 are not allowed in this container (allowed: 16-23).",
	});
	// the saved value is never refused, and an unreadable allowed list checks the syntax only
	assert.deepEqual(validate({ ...form, cpuAffinityList: "0-3" }, { ...data, cpuAffinity: "0-3" }), {});
	assert.deepEqual(validate({ ...form, cpuAffinityList: "0-3" }, { ...data, cpusAllowed: null }), {});
	assert.deepEqual(validate({ ...form, cpuAffinityList: "0-3" }), {});
	// an env lock or another mode is not checked
	assert.deepEqual(validate({ ...form, cpuAffinityList: "x" }, { ...data, locked: ["cpu_affinity"] }), {});
	assert.deepEqual(validate({ ...form, cpuAffinityMode: "auto", cpuAffinityList: "x" }, data), {});
});

it("network: the same errors as the Formik validate", () => {
	const validate = networkValidate(rules);
	assert.deepEqual(validate({ trustedIps: "10.0.0.0/8\n\n192.168.1.5\nfd00::/8" }), {});
	assert.deepEqual(validate({ trustedIps: "10.0.0.0/8\nnope\n1.2.3.4\nbad" }), {
		trustedIps:
			"Line 2: not a valid IPv4/IPv6 address or CIDR range. Line 4: not a valid IPv4/IPv6 address or CIDR range.",
	});
	const many = Array.from({ length: 1001 }, (_, i) => `10.0.${Math.floor(i / 250)}.${i % 250}`).join("\n");
	assert.deepEqual(validate({ trustedIps: many }), { trustedIps: "At most 1000 entries" });
});

it("forward authentication: the same errors as the Formik field rules", () => {
	const validate = forwardAuthValidate(rules);
	const empty = {
		anubisUpstream: "",
		tinyauthUpstream: "",
		oauth2proxyUpstream: "",
		voidauthUpstream: "",
		autheliaUpstream: "",
		authentikUpstream: "",
	};
	assert.deepEqual(validate(empty), {});
	assert.deepEqual(validate({ ...empty, autheliaUpstream: " http://127.0.0.1:9091 " }), {});
	assert.deepEqual(validate({ ...empty, anubisUpstream: "127.0.0.1", authentikUpstream: "https://a:1/path" }), {
		anubisUpstream: "Must be a valid URL with scheme, host and port or with scheme and cu_ upstream name (no path)",
		authentikUpstream:
			"Must be a valid URL with scheme, host and port or with scheme and cu_ upstream name (no path)",
	});
	assert.deepEqual(validate({ ...empty, tinyauthUpstream: `http://${"a".repeat(250)}:1` }), {
		tinyauthUpstream: "Maximum length is 255 characters",
	});
});

it("geoip: starting values with the editions in the API's order", () => {
	assert.deepEqual(geoipValues({ accountId: "123", editions: ["GeoLite2-City", "GeoLite2-Country"] }), {
		accountId: "123",
		licenseKey: "",
		editions: ["GeoLite2-Country", "GeoLite2-City"],
		provider: "dbip",
		dbipEditions: [],
	});
	assert.deepEqual(geoipValues({}), {
		accountId: "",
		licenseKey: "",
		editions: [],
		provider: "dbip",
		dbipEditions: [],
	});
	assert.deepEqual(geoipValues({ provider: "maxmind", dbipEditions: ["ASN", "Country"] }), {
		accountId: "",
		licenseKey: "",
		editions: [],
		provider: "maxmind",
		dbipEditions: ["Country", "ASN"],
	});
});

it("geoip: the MaxMind fields are not checked while the provider is DB-IP", () => {
	const validate = geoipValidate(rules, lockedIn([]));
	const bad = { accountId: "abc", licenseKey: "k".repeat(256), editions: [] };
	assert.deepEqual(validate({ ...bad, provider: "dbip" }), {});
	assert.equal(Object.keys(validate({ ...bad, provider: "maxmind" })).length, 2);
});

it("geoip: switches a DB-IP edition on or off in its order", () => {
	assert.deepEqual(toggleDbipEdition(["ASN"], "Country", true), ["Country", "ASN"]);
	assert.deepEqual(toggleDbipEdition(["Country", "ASN"], "Country", false), ["ASN"]);
});

it("geoip: while DB-IP is the provider the typed account ID and key are not sent", () => {
	const data = { provider: "maxmind", accountId: "7", editions: [], dbipEditions: [], locked: [] };
	const values = { accountId: "abc", licenseKey: "secret", editions: [], provider: "dbip", dbipEditions: [] };
	const { body, startsDownload } = geoipRequest(values, data);
	assert.equal(body.accountId, "7");
	assert.equal(body.licenseKey, "");
	assert.equal(body.provider, "dbip");
	assert.equal(startsDownload, true);
	const same = geoipRequest(values, { ...data, provider: "dbip" });
	assert.equal(same.startsDownload, false);
	assert.equal(same.body.accountId, "7");
	assert.equal("provider" in same.body, false);
});

it("geoip: the provider is sent only when it changed", () => {
	const data = { provider: "maxmind", accountId: "7", editions: [], dbipEditions: [], locked: [] };
	const values = { accountId: "7", licenseKey: "", editions: [], provider: "maxmind", dbipEditions: [] };
	assert.equal("provider" in geoipRequest(values, data).body, false);
	assert.equal(geoipRequest({ ...values, provider: "dbip" }, data).body.provider, "dbip");
});

it("geoip: a provider or DB-IP edition change starts a download, an unchanged form does not", () => {
	const data = { provider: "dbip", dbipEditions: ["Country"], accountId: "", editions: [], locked: [] };
	const values = { accountId: "", licenseKey: "", editions: [], provider: "dbip", dbipEditions: ["Country"] };
	assert.equal(geoipRequest(values, data).startsDownload, false);
	assert.equal(geoipRequest({ ...values, provider: "maxmind" }, data).startsDownload, true);
	assert.equal(geoipRequest({ ...values, dbipEditions: ["Country", "ASN"] }, data).startsDownload, true);
	const locked = { ...data, locked: ["provider", "dbip_editions"] };
	assert.equal(geoipRequest({ ...values, provider: "maxmind", dbipEditions: [] }, locked).startsDownload, false);
});

it("geoip: the same errors as the Formik validate, none for a locked field", () => {
	const validate = geoipValidate(rules, lockedIn([]));
	assert.deepEqual(validate({ accountId: " 1234567890 ", licenseKey: "", editions: [] }), {});
	assert.deepEqual(validate({ accountId: "12345678901", licenseKey: "k".repeat(256), editions: [] }), {
		accountId: "The account ID is a number of up to 10 digits",
		licenseKey: "Maximum length is 255 characters",
	});
	const locked = geoipValidate(rules, lockedIn(["account_id", "license_key"]));
	assert.deepEqual(locked({ accountId: "abc", licenseKey: "k".repeat(256), editions: [] }), {});
});

it("geoip: switches an edition on or off in the API's order", () => {
	assert.deepEqual(toggleEdition(["GeoLite2-City"], "GeoLite2-Country", true), ["GeoLite2-Country", "GeoLite2-City"]);
	assert.deepEqual(toggleEdition(["GeoLite2-Country", "GeoLite2-City"], "GeoLite2-Country", false), [
		"GeoLite2-City",
	]);
});

it("geoip: sends the trimmed values with the locked keys and says when a download starts", () => {
	const data = {
		accountId: "1",
		editions: ["GeoLite2-Country"],
		provider: "maxmind",
		dbipEditions: ["Country"],
		locked: [],
	};
	const values = {
		accountId: " 1 ",
		licenseKey: "",
		editions: ["GeoLite2-Country"],
		provider: "maxmind",
		dbipEditions: ["Country"],
	};
	assert.deepEqual(geoipRequest(values, data), {
		body: {
			accountId: "1",
			licenseKey: "",
			editions: ["GeoLite2-Country"],
			dbipEditions: ["Country"],
			locked: [],
		},
		startsDownload: false,
	});
	assert.equal(geoipRequest({ ...values, licenseKey: " key " }, data).body.licenseKey, "key");
	assert.equal(geoipRequest({ ...values, licenseKey: " key " }, data).startsDownload, true);
	assert.equal(geoipRequest({ ...values, accountId: "2" }, data).startsDownload, true);
	assert.equal(geoipRequest({ ...values, editions: ["GeoLite2-ASN"] }, data).startsDownload, true);
	const locked = { ...data, locked: ["account_id", "license_key", "editions"] };
	const lockedValues = {
		accountId: "2",
		licenseKey: "k",
		editions: [],
		provider: "maxmind",
		dbipEditions: ["Country"],
	};
	assert.deepEqual(geoipRequest(lockedValues, locked), {
		body: {
			accountId: "2",
			licenseKey: "k",
			editions: [],
			dbipEditions: ["Country"],
			locked: ["account_id", "license_key", "editions"],
		},
		startsDownload: false,
	});
});

const DATA = {
	trafficEnabled: true,
	retentionDays: 30,
	showIps: true,
	uniqueVisitors: true,
	visitorsCap: 5000,
	locked: [],
};
const LOGS = {
	writeLogFiles: true,
	logFormat: "classic",
	tlsHandshakeLog: false,
	logRotations: 7,
	goaccess: false,
	goaccessKeepDays: 30,
	goaccessAnonymize: "off",
	goaccessDropQueryStrings: false,
	goaccessRealOs: false,
	goaccessResolveHosts: false,
	locked: [],
};

it("monitoring: starting values in the section's order, numbers as text", () => {
	const values = monitoringValues(DATA, LOGS);
	assert.deepEqual(Object.keys(values), [
		"writeLogFiles",
		"logFormat",
		"tlsHandshakeLog",
		"logRotations",
		"goaccess",
		"goaccessKeepDays",
		"goaccessAnonymize",
		"goaccessDropQueryStrings",
		"goaccessRealOs",
		"goaccessResolveHosts",
		"trafficEnabled",
		"retentionDays",
		"showIps",
		"uniqueVisitors",
		"visitorsCap",
	]);
	assert.equal(values.retentionDays, "30");
	assert.equal(values.logRotations, "7");
	assert.equal(
		monitoringValues({ ...DATA, visitorsCap: undefined }, { ...LOGS, goaccessKeepDays: null }).visitorsCap,
		"100000",
	);
	assert.equal(monitoringValues(DATA, { ...LOGS, goaccessKeepDays: null }).goaccessKeepDays, "");
});

it("monitoring: the log format is sent only when changed and not locked", () => {
	const saved = monitoringValues(DATA, LOGS);
	assert.equal(saved.logFormat, "classic");
	assert.deepEqual(monitoringRequest({ ...saved, logFormat: "json" }, DATA, LOGS).logs, { logFormat: "json" });
	const locked = { ...LOGS, locked: ["log_format"] };
	assert.equal(monitoringRequest({ ...saved, logFormat: "json" }, DATA, locked).logs, null);
});

it("monitoring: the TLS handshake log is sent only when changed and not locked, with Write log files when both change", () => {
	const saved = monitoringValues(DATA, LOGS);
	assert.equal(saved.tlsHandshakeLog, false);
	assert.deepEqual(monitoringRequest({ ...saved, tlsHandshakeLog: true }, DATA, LOGS).logs, {
		tlsHandshakeLog: true,
	});
	const locked = { ...LOGS, locked: ["tls_handshake_log"] };
	assert.equal(monitoringRequest({ ...saved, tlsHandshakeLog: true }, DATA, locked).logs, null);
	const filesOff = { ...LOGS, tlsHandshakeLog: true };
	const savedOn = monitoringValues(DATA, filesOff);
	assert.deepEqual(monitoringRequest({ ...savedOn, writeLogFiles: false }, DATA, filesOff).logs, {
		writeLogFiles: false,
	});
});

it("monitoring: the TLS handshake log is not sent while Write log files goes off in the same save", () => {
	const saved = monitoringValues(DATA, LOGS);
	// turned on, then Write log files turned off before the save: the switch shows off, the API would refuse it
	assert.deepEqual(monitoringRequest({ ...saved, tlsHandshakeLog: true, writeLogFiles: false }, DATA, LOGS).logs, {
		writeLogFiles: false,
	});
	// a Write log files locked on (CrowdSec) keeps it sendable
	const crowdsec = { ...LOGS, locked: ["write_log_files"] };
	assert.deepEqual(monitoringRequest({ ...saved, tlsHandshakeLog: true }, DATA, crowdsec).logs, {
		tlsHandshakeLog: true,
	});
});

it("monitoring: the same errors as the Formik validate", () => {
	const validate = monitoringValidate(rules, []);
	const values = monitoringValues(DATA, LOGS);
	assert.deepEqual(validate(values), {});
	assert.deepEqual(
		validate({ ...values, retentionDays: "6", logRotations: "0", goaccessKeepDays: "", visitorsCap: "999" }),
		{
			retentionDays: RANGE(7, 365),
			logRotations: RANGE(1, 1000),
			goaccessKeepDays: RANGE(1, 366),
			visitorsCap: RANGE(1000, 1000000),
		},
	);
	assert.deepEqual(validate({ ...values, uniqueVisitors: false, visitorsCap: "1" }), {});
	const locked = monitoringValidate(rules, ["log_rotations", "goaccess_keep_days"]);
	assert.deepEqual(locked({ ...values, logRotations: "0", goaccessKeepDays: "" }), {});
});

it("monitoring: sends only what changed, and says what a save switches off", () => {
	const saved = monitoringValues(DATA, LOGS);
	assert.deepEqual(monitoringRequest(saved, DATA, LOGS), {
		logs: null,
		monitoring: null,
		trafficOff: false,
		ipsOff: false,
		visitorsOff: false,
	});
	assert.deepEqual(monitoringRequest({ ...saved, logRotations: "8", goaccess: true }, DATA, LOGS).logs, {
		logRotations: 8,
		goaccess: true,
	});
	assert.deepEqual(monitoringRequest({ ...saved, retentionDays: "60" }, DATA, LOGS).monitoring, {
		trafficEnabled: true,
		retentionDays: 60,
		showIps: true,
		uniqueVisitors: true,
		visitorsCap: 5000,
		locked: [],
	});
	const off = monitoringRequest(
		{ ...saved, trafficEnabled: false, showIps: false, uniqueVisitors: false },
		DATA,
		LOGS,
	);
	assert.deepEqual(off.monitoring, {
		trafficEnabled: false,
		retentionDays: 30,
		showIps: false,
		uniqueVisitors: false,
		locked: [],
	});
	assert.deepEqual([off.trafficOff, off.ipsOff, off.visitorsOff], [true, true, true]);
	const lockedData = { ...DATA, locked: ["traffic_enabled"] };
	assert.equal(monitoringRequest({ ...saved, trafficEnabled: false }, lockedData, LOGS).trafficOff, false);
	// a number retyped as it was is no change
	assert.equal(monitoringRequest({ ...saved, retentionDays: "30" }, DATA, LOGS).monitoring, null);
});

it("monitoring: the dialog of visitor IPs and unique visitors going off", () => {
	assert.equal(monitoringConfirmKey(true, true), "settings.monitoring.both-off");
	assert.equal(monitoringConfirmKey(true, false), "settings.monitoring.show-ips");
	assert.equal(monitoringConfirmKey(false, true), "settings.monitoring.unique-visitors");
});
