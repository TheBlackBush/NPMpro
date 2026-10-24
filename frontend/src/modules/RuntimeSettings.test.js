import assert from "node:assert/strict";
import { it } from "node:test";
import { defaultKeySize, keySizeOptions, parseTrustedIps, runtimeSettingsPayload } from "./RuntimeSettings.js";

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
