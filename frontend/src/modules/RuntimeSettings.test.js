import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import {
	appliesMessageId,
	defaultKeySize,
	fieldOfError,
	GROUP_KEYS,
	isEmptyPayload,
	keySizeOptions,
	parseTrustedIps,
	runtimeSettingsPayload,
} from "./RuntimeSettings.js";

it("keySizeOptions follows the key type", () => {
	assert.deepEqual(keySizeOptions("ecdsa"), ["secp256r1", "secp384r1", "secp521r1"]);
	assert.deepEqual(keySizeOptions("rsa"), ["2048", "3072", "4096"]);
	assert.deepEqual(keySizeOptions("nope"), keySizeOptions("ecdsa"));
	assert.equal(defaultKeySize("rsa"), "4096");
	assert.equal(defaultKeySize("ecdsa"), "secp384r1");
});

it("runtimeSettingsPayload drops locked keys, unknown keys and unchanged values", () => {
	const values = { keyType: "rsa", keySize: "2048", mustStaple: true, applies: {}, locked: ["key_type"] };
	assert.deepEqual(runtimeSettingsPayload("certificates", values, ["key_type"]), {
		keySize: "2048",
		mustStaple: true,
	});
	const initial = { keyType: "rsa", keySize: "4096", mustStaple: true };
	assert.deepEqual(runtimeSettingsPayload("certificates", values, [], initial), { keySize: "2048" });
	assert.deepEqual(
		runtimeSettingsPayload("network", { trustedIps: ["1.1.1.1"] }, [], { trustedIps: ["1.1.1.1"] }),
		{},
	);
	assert.deepEqual(
		runtimeSettingsPayload("network", { trustedIps: ["1.1.1.1"], trustCloudflare: true }, ["trusted_ips"]),
		{
			trustCloudflare: true,
		},
	);
	assert.deepEqual(runtimeSettingsPayload("forward-auth", { anubisUpstream: "" }, ["anubis_custom_images"]), {
		anubisUpstream: "",
	});
	assert.deepEqual(runtimeSettingsPayload("nope", { a: 1 }, []), {});
});

it("parseTrustedIps accepts addresses and CIDR ranges, one per line", () => {
	const text = "10.0.0.1\n\n  192.168.0.0/16 \r\n2001:db8::/32\n::1\n::ffff:1.2.3.4\n1:2:3:4:5:6:7:8\n0.0.0.0/0";
	const { list, errors } = parseTrustedIps(text);
	assert.deepEqual(errors, []);
	assert.equal(list.length, 7);
	assert.deepEqual(parseTrustedIps(""), { list: [], errors: [] });
});

it("parseTrustedIps reports the 1-based line of each bad entry", () => {
	const bad = [
		"",
		"1.2.3",
		"1.2.3.4/33",
		"::/129",
		"1.2.3.4/",
		"256.1.1.1",
		"a.b.c.d",
		"1::2::3",
		"1.2.3.4/8/8",
		"host",
		"1:2:3:4:5:6:7",
	];
	const { list, errors } = parseTrustedIps(`10.0.0.1\n${bad.join("\n")}`);
	assert.deepEqual(list, ["10.0.0.1"]);
	const lines = bad.map((entry, i) => [entry, i + 2]).filter(([entry]) => entry !== "");
	assert.deepEqual(
		errors.map((e) => e.line),
		lines.map(([, line]) => line),
	);
	assert.ok(errors.every((e) => e.message.startsWith("settings.")));
});

it("isEmptyPayload", () => {
	assert.equal(isEmptyPayload({}), true);
	assert.equal(isEmptyPayload(undefined), true);
	assert.equal(isEmptyPayload({ gravatar: false }), false);
});

it("runtimeSettingsPayload for logs and advanced", () => {
	const logs = { writeLogFiles: true, logRotations: 5 };
	assert.deepEqual(runtimeSettingsPayload("logs", logs, [], { writeLogFiles: false, logRotations: 5 }), {
		writeLogFiles: true,
	});
	assert.deepEqual(runtimeSettingsPayload("logs", logs, ["write_log_files"]), { logRotations: 5 });
	const advanced = { configBeautifier: false, gravatar: true };
	assert.deepEqual(runtimeSettingsPayload("advanced", advanced, ["gravatar"], { configBeautifier: true }), {
		configBeautifier: false,
	});
	assert.deepEqual(runtimeSettingsPayload("advanced", advanced, [], advanced), {});
});

it("runtimeSettingsPayload treats a missing or null initial value as changed", () => {
	assert.deepEqual(runtimeSettingsPayload("certificates", { profile: "" }, [], { profile: null }), { profile: "" });
	assert.deepEqual(runtimeSettingsPayload("certificates", { profile: "" }, [], {}), { profile: "" });
	assert.deepEqual(runtimeSettingsPayload("certificates", { profile: undefined }, [], {}), {});
});

it("GROUP_KEYS match the backend response schemas", () => {
	const camel = (s) => s.replaceAll(/_(?<c>[a-z])/gu, (...m) => m.at(-1).c.toUpperCase());
	for (const group of Object.keys(GROUP_KEYS)) {
		const url = new URL(`../../../backend/schema/components/runtime-${group}-setting-object.json`, import.meta.url);
		const props = Object.keys(JSON.parse(readFileSync(url, "utf8")).properties).filter(
			(key) => !["locked", "locked_by", "applies"].includes(key),
		);
		assert.deepEqual([...GROUP_KEYS[group]].sort(), props.map(camel).sort(), group);
	}
	assert.equal(Object.keys(GROUP_KEYS).length, 5);
});

it("appliesMessageId maps the applies values to their translation ids", () => {
	const applies = { keyType: "next-certificate", ocspStapling: "reload", renewalInterval: "immediately", x: "later" };
	assert.equal(appliesMessageId(applies, "keyType"), "settings.runtime.applies.next-certificate");
	assert.equal(appliesMessageId(applies, "ocspStapling"), "settings.runtime.applies.reload");
	assert.equal(appliesMessageId(applies, "renewalInterval"), "settings.runtime.applies.immediately");
	assert.equal(appliesMessageId(applies, "x"), null);
	assert.equal(appliesMessageId(applies, "missing"), null);
	assert.equal(appliesMessageId(undefined, "keyType"), null);
});

it("fieldOfError finds the field of a prefixed backend error of the group", () => {
	assert.deepEqual(fieldOfError("forward-auth", "anubis_upstream: still used by proxy hosts: a.example"), {
		key: "anubisUpstream",
		message: "still used by proxy hosts: a.example",
	});
	assert.deepEqual(fieldOfError("certificates", "default_certificate_id: Certificate not found"), {
		key: "defaultCertificateId",
		message: "Certificate not found",
	});
	// another group's key, no prefix, nginx output
	assert.equal(fieldOfError("network", "anubis_upstream: x"), null);
	assert.equal(fieldOfError("network", "The ACME server does not offer this profile"), null);
	assert.equal(fieldOfError("logs", 'nginx: [emerg] unknown directive "x" in /a.conf:1'), null);
	assert.equal(fieldOfError("logs", undefined), null);
});

it("camelizes the keys of locked_by and keeps the env names", async () => {
	const { camelizeKeys } = await import("../api/backend/caseConvert.js");
	const data = camelizeKeys({
		locked: ["key_type"],
		locked_by: { key_type: "ACME_KEY_SIZE", write_log_files: "GOA" },
	});
	assert.deepEqual(data.lockedBy, { keyType: "ACME_KEY_SIZE", writeLogFiles: "GOA" });
	assert.deepEqual(data.locked, ["key_type"]);
});
