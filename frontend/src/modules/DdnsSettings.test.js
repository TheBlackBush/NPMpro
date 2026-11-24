import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	ddnsSettingsValidate,
	ddnsTimeMs,
	ddnsToApi,
	ddnsToForm,
	isServiceUrl,
	serviceListProblem,
} from "./DdnsSettings.js";
import { createValidations } from "./ValidationRules.js";

const rules = createValidations(createIntl({ locale: "en", messages: en }));
const data = {
	period: "5m",
	cooldown: "5m",
	ipv4Services: ["https://ipv4.example/"],
	ipv6Services: ["https://ipv6.example/"],
	resolver: [],
};

it("reads a time from 1m to 24h as the backend does", () => {
	assert.equal(ddnsTimeMs("5m"), 300_000);
	assert.equal(ddnsTimeMs("90"), 90_000);
	assert.equal(ddnsTimeMs("1h30m"), 5_400_000);
	assert.equal(ddnsTimeMs("24h"), 86_400_000);
	for (const bad of ["59s", "25h", "", "5x", "1m1h", "0", 5, null]) assert.equal(ddnsTimeMs(bad), null, String(bad));
});

it("accepts https service URLs only", () => {
	assert.equal(isServiceUrl("https://api.ipify.org"), true);
	assert.equal(isServiceUrl("https://[2606:4700::1111]:8443/ip"), true);
	for (const bad of [
		"http://a.example",
		"https://user:pw@a.example",
		"ftp://a.example",
		`https://${"a".repeat(200)}`,
	]) {
		assert.equal(isServiceUrl(bad), false, bad);
	}
});

it("names the first problem of a service list", () => {
	assert.equal(serviceListProblem(["https://a.example", "https://b.example"]), null);
	// a new address needs a second service to confirm it
	assert.deepEqual(serviceListProblem(["https://a.example"]), { error: "count" });
	assert.deepEqual(serviceListProblem([]), { error: "count" });
	assert.deepEqual(serviceListProblem("https://a.example"), { error: "count" });
	assert.deepEqual(serviceListProblem(["http://b.example"]), { error: "invalid", url: "http://b.example" });
	assert.deepEqual(serviceListProblem(Array.from({ length: 11 }, () => "https://a.example")), { error: "count" });
	assert.deepEqual(serviceListProblem(["https://a.example", "http://b.example"]), {
		error: "invalid",
		url: "http://b.example",
	});
});

it("validates the form and lets a stored value pass", () => {
	assert.deepEqual(ddnsSettingsValidate(rules, ddnsToForm(data), data), {});
	const errors = ddnsSettingsValidate(
		rules,
		{ ...ddnsToForm(data), period: "10s", ipv4Services: [], ipv6Services: ["http://x.example"], resolver: ["dns"] },
		data,
	);
	assert.deepEqual(
		Object.keys(errors).sort((a, b) => a.localeCompare(b)),
		["ipv4Services", "ipv6Services", "period", "resolver"],
	);
	assert.ok(errors.ipv6Services.includes("http://x.example"));
	// a stored value that the rules would refuse is kept without a message
	const odd = { ...data, period: "30s", resolver: ["dns.example"], ipv4Services: ["https://a.example"] };
	assert.deepEqual(ddnsSettingsValidate(rules, ddnsToForm(odd), odd), {});
});

it("trims the times and keeps the lists as they are", () => {
	const api = ddnsToApi({ ...ddnsToForm(data), period: " 10m ", cooldown: "1h" });
	assert.equal(api.period, "10m");
	assert.deepEqual(api.ipv4Services, data.ipv4Services);
});

it("validates a new form without loaded data, with missing values and a non-array service list", () => {
	const errors = ddnsSettingsValidate(rules, {
		period: undefined,
		cooldown: null,
		ipv4Services: "https://a.example/",
		ipv6Services: [],
		resolver: undefined,
	});
	assert.ok(errors.period && errors.cooldown);
	assert.ok(errors.ipv4Services && errors.ipv6Services);
	assert.equal(errors.resolver, undefined);
	assert.deepEqual(serviceListProblem(undefined), { error: "count" });
});

it("refuses an invalid resolver address, a duplicate and too many, and keeps a stored list", () => {
	const form = { ...ddnsToForm(data) };
	const check = (resolver, stored = data) => ddnsSettingsValidate(rules, { ...form, resolver }, stored).resolver;
	assert.ok(check(["not an address"]));
	assert.ok(check(["9.9.9.9", "9.9.9.9"]));
	assert.ok(check(Array.from({ length: 20 }, (_, i) => `9.9.9.${i}`)));
	assert.equal(check(["9.9.9.9"]), undefined);
	assert.equal(check(["not an address"], { ...data, resolver: ["not an address"] }), undefined);
});

it("fills the form and the request from missing values", () => {
	assert.deepEqual(ddnsToForm({}), { period: "", cooldown: "", ipv4Services: [], ipv6Services: [], resolver: [] });
	assert.equal(ddnsToApi({ period: undefined, cooldown: " 5m " }).cooldown, "5m");
	assert.equal(ddnsToApi({}).period, "");
});
