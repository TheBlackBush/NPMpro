import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

let api;
let certbot;

const release = path.join("fake", "release-certbot");
const waiting = () => `#!/bin/sh
while [ ! -f "${path.join(api.root, release)}" ]; do sleep 0.05; done
exit "$(cat "${path.join(api.root, release)}")"
`;

before(async () => {
	api = await startApi();
	certbot = await import("../lib/certbot.js");
});
after(() => api?.stop());

const letGo = (code = 0) => writeFile(path.join(api.root, release), String(code));

it("counts a certbot run while it goes on and not after it", async () => {
	assert.equal(certbot.certbotRunning(), 0);
	await api.outside.hookCommand("certbot", waiting());
	const first = certbot.runCertbot(["renew"]);
	const second = certbot.runCertbot(["renew"]);
	assert.equal(certbot.certbotRunning(), 2);
	await letGo();
	await Promise.all([first, second]);
	assert.equal(certbot.certbotRunning(), 0);
});

it("lowers the count after a failing run too", async () => {
	await api.outside.hookCommand("certbot", "#!/bin/sh\necho nope >&2\nexit 1\n");
	await assert.rejects(certbot.runCertbot(["renew"]));
	assert.equal(certbot.certbotRunning(), 0);
});

it("counts a plugin install", async () => {
	await api.outside.hookCommand("pip", waiting());
	const install = certbot.installPlugin("cloudflare");
	assert.equal(certbot.certbotRunning(), 1);
	await letGo();
	await install;
	assert.equal(certbot.certbotRunning(), 0);
});
