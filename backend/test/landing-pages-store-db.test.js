import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

// the landing_pages row: no row reads as the defaults, the first save inserts it, the next one patches it

let api;

before(async () => {
	api = await startApi();
});
after(() => api.stop());

it("a missing row is null, a save creates it and a second save updates it", async () => {
	const { LANDING_ID, readStoredLandingPages, saveStoredLandingPages } = await import(
		"../lib/landing-pages/store.js"
	);
	assert.equal(await readStoredLandingPages(), null);
	await saveStoredLandingPages({ pages: { ban: { choice: "custom", html: "<p>b</p>" } } });
	assert.deepEqual(await readStoredLandingPages(), { pages: { ban: { choice: "custom", html: "<p>b</p>" } } });
	await saveStoredLandingPages({ pages: {}, imported_on: "now" });
	assert.deepEqual(await readStoredLandingPages(), { pages: {}, imported_on: "now" });
	assert.equal((await api.db("setting").where({ id: LANDING_ID })).length, 1);
});
