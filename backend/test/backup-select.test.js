import assert from "node:assert/strict";
import { it } from "node:test";
import { certificateFileFilter, itemLabel, linkedOf, selectRows } from "../lib/backup/select.js";

it("labels items by domains, port, name or email", () => {
	assert.equal(
		itemLabel("proxy_hosts", { id: 3, domain_names: '["a.example.com","b.example.com"]' }),
		"a.example.com, b.example.com",
	);
	assert.equal(itemLabel("certificates", { id: 4, domain_names: [], nice_name: "Client CA" }), "Client CA");
	assert.equal(
		itemLabel("streams", { id: 5, incoming_port: 2222, tcp_forwarding: 1, udp_forwarding: 1 }),
		"2222 (tcp+udp)",
	);
	assert.equal(itemLabel("users", { id: 2, name: "Bob", email: "bob@example.com" }), "Bob (bob@example.com)");
	assert.equal(itemLabel("access_lists", { id: 9 }), "#9");
});

it("keeps the chosen rows and their child rows", () => {
	const rows = {
		proxy_host: [{ id: 1 }, { id: 2 }],
		npmpro_location: [
			{ id: 10, proxy_host_id: 1 },
			{ id: 11, proxy_host_id: 2 },
		],
		npmpro_proxy_host_access_list: [{ proxy_host_id: 2, location_id: 0, access_list_id: 5 }],
	};
	assert.deepEqual(selectRows("proxy_hosts", rows, ["2"]), {
		proxy_host: [{ id: 2 }],
		npmpro_location: [{ id: 11, proxy_host_id: 2 }],
		npmpro_proxy_host_access_list: [{ proxy_host_id: 2, location_id: 0, access_list_id: 5 }],
	});
	assert.equal(selectRows("proxy_hosts", rows, undefined), rows);
});

it("finds the certificates, access lists and DNS credentials the chosen rows need", () => {
	const linked = linkedOf({
		proxy_hosts: {
			proxy_host: [
				{ id: 1, certificate_id: 4, npmpro_mtls_certificate_id: 6 },
				{ id: 2, certificate_id: 4, npmpro_mtls_certificate_id: 0 },
			],
			npmpro_location: [],
			npmpro_proxy_host_access_list: [{ proxy_host_id: 2, location_id: 0, access_list_id: 5 }],
		},
		certificates: { certificate: [{ id: 4, npmpro_dns_credential_id: 7 }] },
	});
	assert.deepEqual([...linked.certificates.get("4")].sort(), ["proxy_hosts:1", "proxy_hosts:2"]);
	assert.deepEqual([...linked.certificates.get("6")], ["proxy_hosts:1"]);
	assert.deepEqual([...linked.access_lists.get("5")], ["proxy_hosts:2"]);
	assert.deepEqual([...linked.dns_credentials.get("7")], ["certificates:4"]);
});

it("filters certificate files by id and keeps the shared accounts", () => {
	const allow = certificateFileFilter([3]);
	assert.equal(allow("tls/certbot/archive/npm-3/cert1.pem"), true);
	assert.equal(allow("tls/certbot/renewal/npm-3.conf"), true);
	assert.equal(allow("tls/custom/npm-3/fullchain.pem"), true);
	assert.equal(allow("tls/mtls/npm-3.pem"), true);
	assert.equal(allow("tls/certbot/archive/npm-33/cert1.pem"), false);
	assert.equal(allow("tls/custom/npm-4.der"), false);
	assert.equal(allow("tls/certbot/accounts/acme-v02.api.letsencrypt.org/directory/abc/regr.json"), true);
});
