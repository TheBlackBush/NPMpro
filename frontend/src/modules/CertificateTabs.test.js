import assert from "node:assert/strict";
import { it } from "node:test";
import { CERTIFICATE_TABS, certificateTab } from "./CertificateTabs.js";

it("lists the four tabs in order with their routes", () => {
	assert.deepEqual(
		CERTIFICATE_TABS.map((tab) => [tab.key, tab.to]),
		[
			["certificates", "/certificates"],
			["dns-credentials", "/certificates/dns-credentials"],
			["domains", "/certificates/domains"],
			["dynamic-dns", "/certificates/dynamic-dns"],
		],
	);
});

it("opens the DNS Credentials tab on its route and below it", () => {
	assert.equal(certificateTab("/certificates/dns-credentials"), "dns-credentials");
	assert.equal(certificateTab("/certificates/dns-credentials/"), "dns-credentials");
});

it("opens the Domains tab on its route and below it", () => {
	assert.equal(certificateTab("/certificates/domains"), "domains");
	assert.equal(certificateTab("/certificates/domains/"), "domains");
	assert.equal(certificateTab("/certificates/domainsx"), "certificates");
});

it("opens the Dynamic DNS tab on its route and below it", () => {
	assert.equal(certificateTab("/certificates/dynamic-dns"), "dynamic-dns");
	assert.equal(certificateTab("/certificates/dynamic-dns/"), "dynamic-dns");
	assert.equal(certificateTab("/certificates/dynamic-dnsx"), "certificates");
});

it("opens the Certificates tab everywhere else under /certificates", () => {
	assert.equal(certificateTab("/certificates"), "certificates");
	assert.equal(certificateTab("/certificates/"), "certificates");
	assert.equal(certificateTab("/certificates/dns-credentialsx"), "certificates");
});
