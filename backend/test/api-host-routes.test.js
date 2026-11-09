import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

const TYPES = [
	{ path: "/nginx/proxy-hosts", word: "host", accessLists: 200 },
	{ path: "/nginx/redirection-hosts", word: "host", accessLists: 400 },
	{ path: "/nginx/dead-hosts", word: "host", accessLists: 400 },
	{ path: "/nginx/streams", word: "stream", accessLists: 400 },
];
let api;
let admin;

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

for (const { path, word, accessLists } of TYPES) {
	it(`${path}: the expand enum of the type`, async () => {
		assert.equal((await admin.get(`${path}?expand=owner,certificate`)).status, 200);
		assert.equal((await admin.get(`${path}?expand=access_lists`)).status, accessLists);
		assert.equal((await admin.get(`${path}?expand=nothing`)).status, 400);
	});

	it(`${path}: a bad id answers 400 and names the ${word}`, async () => {
		for (const [method, url] of [
			["get", `${path}/abc`],
			["delete", `${path}/1.5`],
			["post", `${path}/0/enable`],
			["post", `${path}/0/disable`],
		]) {
			const answer = await admin[method](url);
			assert.equal(answer.status, 400, url);
			assert.equal(answer.body.error.message, `The ${word} id must be a positive integer`);
		}
	});

	it(`${path}: the errors of the service reach the error handler`, async () => {
		assert.equal((await admin.get(`${path}/99999`)).status, 404);
		assert.equal((await admin.put(`${path}/99999`, { nonsense: true })).status, 400);
		assert.equal((await api.client().get(path)).status, 401);
		assert.equal((await admin.get(`${path}/1/nothing`)).status, 404);
	});
}
