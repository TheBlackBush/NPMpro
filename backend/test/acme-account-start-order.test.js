import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
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

it("a failed read of the stored CA stops the start pass and writes no startup-settings.env", async () => {
	const { default: settingModel } = await import("../models/setting.js");
	const { setStoredAcmeServer } = await import("../lib/acme-server.js");
	const { prepareApp } = await import("../startup.js");
	setStoredAcmeServer(null);
	const file = path.join(api.root, "data/npmpro/startup-settings.env");
	await rm(file, { force: true });
	const query = settingModel.query;
	settingModel.query = () => {
		throw new Error("database busy");
	};
	try {
		await assert.rejects(prepareApp({ background: false }), { message: "database busy" });
	} finally {
		settingModel.query = query;
	}
	await assert.rejects(readFile(file), { code: "ENOENT" });
	await prepareApp({ background: false });
	assert.match(await readFile(file, "utf8"), new RegExp(`^ACME_SERVER=${STORED}$`, "mu"));
});
