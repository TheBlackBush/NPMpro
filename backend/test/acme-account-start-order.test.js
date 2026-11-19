import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

const STORED = "https://stored.test/dir";
let api;

before(async () => {
	api = await startApi({ env: { NPMPRO_TEST_OUTBOUND: "mock" } });
});
after(() => api.stop());

it("a start loads the stored CA before it writes startup-settings.env, so the ACME_SERVER line stays", async () => {
	const { saveAcmeSetting } = await import("../internal/acme-account.js");
	const { setStoredAcmeServer } = await import("../lib/acme-server.js");
	await saveAcmeSetting(STORED);
	setStoredAcmeServer(null);
	await rm(path.join(api.root, "data/npmpro/startup-settings.env"), { force: true });
	const { prepareApp } = await import("../startup.js");
	await prepareApp({ background: false });
	assert.match(await api.read("data/npmpro/startup-settings.env"), new RegExp(`^ACME_SERVER=${STORED}$`, "mu"));
});
