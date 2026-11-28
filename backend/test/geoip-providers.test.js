import assert from "node:assert/strict";
import { it } from "node:test";
import {
	asnFileOf,
	countryFileOf,
	effectiveProvider,
	PROVIDER_IDS,
	PROVIDERS,
	providerOf,
	selectedEditions,
} from "../lib/geoip/providers.js";

it("file names per provider and edition", () => {
	assert.deepEqual(PROVIDER_IDS, ["dbip", "maxmind"]);
	assert.equal(PROVIDERS.dbip.file("Country"), "dbip-country-lite.mmdb");
	assert.equal(PROVIDERS.dbip.file("ASN"), "dbip-asn-lite.mmdb");
	assert.equal(PROVIDERS.maxmind.file("GeoLite2-City"), "GeoLite2-City.mmdb");
	assert.equal(countryFileOf("dbip"), "dbip-country-lite.mmdb");
	assert.equal(asnFileOf("dbip"), "dbip-asn-lite.mmdb");
	assert.equal(countryFileOf("maxmind"), "GeoLite2-Country.mmdb");
	assert.equal(asnFileOf("maxmind"), "GeoLite2-ASN.mmdb");
	assert.equal(providerOf("bogus"), PROVIDERS.dbip);
	assert.equal(PROVIDERS.dbip.needsCredentials, false);
	assert.equal(PROVIDERS.maxmind.needsCredentials, true);
});

it("database type checks", () => {
	const dbip = PROVIDERS.dbip;
	assert.equal(dbip.typeMatches("Country", "DBIP-Country-Lite"), true);
	assert.equal(dbip.typeMatches("ASN", "DBIP-ASN-Lite (compat=GeoLite2-ASN)"), true);
	assert.equal(dbip.typeMatches("Country", "GeoLite2-Country"), false);
	assert.equal(dbip.typeMatches("ASN", "DBIP-Country-Lite"), false);
	const maxmind = PROVIDERS.maxmind;
	assert.equal(maxmind.typeMatches("GeoLite2-Country", "GeoLite2-Country"), true);
	assert.equal(maxmind.typeMatches("GeoLite2-ASN", "GeoLite2-Country"), false);
	assert.equal(maxmind.typeMatches("GeoLite2-City", "GeoLite2-City"), true);
});

it("selected editions follow the provider", () => {
	const values = { editions: ["GeoLite2-City"], dbip_editions: ["ASN"] };
	assert.deepEqual(selectedEditions({ ...values, provider: "maxmind" }), ["GeoLite2-City"]);
	assert.deepEqual(selectedEditions({ ...values, provider: "dbip" }), ["ASN"]);
});

it("effective provider: env, stored, credentials, default", () => {
	assert.equal(effectiveProvider({ envValue: "dbip", stored: "maxmind", credentials: true }), "dbip");
	assert.equal(effectiveProvider({ envValue: "MaxMind ", credentials: false }), "maxmind");
	assert.equal(effectiveProvider({ envValue: "foo", stored: "maxmind", credentials: false }), "maxmind");
	assert.equal(effectiveProvider({ credentials: true }), "maxmind");
	assert.equal(effectiveProvider({ credentials: false }), "dbip");
	assert.equal(effectiveProvider({ stored: "bogus", credentials: true }), "maxmind");
	assert.equal(effectiveProvider({ stored: "bogus", credentials: false }), "dbip");
	assert.equal(effectiveProvider({ stored: "dbip", credentials: true }), "dbip");
});
