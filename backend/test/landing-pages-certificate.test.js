import assert from "node:assert/strict";
import { it } from "node:test";
import { certificateUnusable } from "../lib/landing-pages/certificate.js";

const present = (files) => async (file) => files.includes(file);

it("only a host that forces HTTPS, has a certificate and misses one of its files", async () => {
	const host = { ssl_forced: true, certificate_id: 5, certificate: { provider: "letsencrypt" } };
	const live = "/data/tls/certbot/live/npm-5";
	assert.equal(
		await certificateUnusable(host, { exists: present([`${live}/fullchain.pem`, `${live}/privkey.pem`]) }),
		false,
	);
	assert.equal(await certificateUnusable(host, { exists: present([`${live}/fullchain.pem`]) }), true);
	assert.equal(await certificateUnusable({ ...host, ssl_forced: false }, { exists: present([]) }), false);
	assert.equal(await certificateUnusable({ ...host, certificate: null }, { exists: present([]) }), false);
	const custom = { ...host, certificate: { provider: "other" } };
	assert.equal(
		await certificateUnusable(custom, {
			exists: present(["/data/tls/custom/npm-5/fullchain.pem", "/data/tls/custom/npm-5/privkey.pem"]),
		}),
		false,
	);
	assert.equal(await certificateUnusable(custom, { exists: present([]) }), true);
});

it("the default check reads the container paths", async () => {
	const host = { ssl_forced: true, certificate_id: 987654, certificate: { provider: "other" } };
	assert.equal(await certificateUnusable(host), true);
});
