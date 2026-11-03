import assert from "node:assert/strict";
import { it } from "node:test";
import { CERTIFICATE_TABS, certificateTab } from "./CertificateTabs.js";

it("lists the two tabs in order with their routes", () => {
	assert.deepEqual(
		CERTIFICATE_TABS.map((tab) => [tab.key, tab.to]),
		[
			["certificates", "/certificates"],
			["dns-credentials", "/certificates/dns-credentials"],
		],
	);
});

it("opens the DNS Credentials tab on its route and below it", () => {
	assert.equal(certificateTab("/certificates/dns-credentials"), "dns-credentials");
	assert.equal(certificateTab("/certificates/dns-credentials/"), "dns-credentials");
});

it("opens the Certificates tab everywhere else under /certificates", () => {
	assert.equal(certificateTab("/certificates"), "certificates");
	assert.equal(certificateTab("/certificates/"), "certificates");
	assert.equal(certificateTab("/certificates/dns-credentialsx"), "certificates");
});
