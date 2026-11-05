import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

// Access lists, certificates and DNS credentials: the id in the path is an integer of at least 1 (schema common id),
// for PUT and DELETE like for GET. The host and stream types run the same cases in test/support/hosts.js.

let api;
let admin;

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

const BAD_IDS = ["abc", "0", "1.5", "1abc", "-1"];
const URLS = ["/nginx/access-lists", "/nginx/certificates", "/nginx/dns-credentials"];

it("answers PUT and DELETE with an id that is no positive integer with 400", async () => {
	for (const url of URLS) {
		for (const id of BAD_IDS) {
			const put = await admin.put(`${url}/${id}`, {});
			assert.equal(put.status, 400, `PUT ${url}/${id}: ${put.status}`);
			const del = await admin.delete(`${url}/${id}`);
			assert.equal(del.status, 400, `DELETE ${url}/${id}: ${del.status}`);
		}
	}
});

it("still answers 404 for a well-formed id that does not exist", async () => {
	for (const url of URLS) {
		assert.equal((await admin.delete(`${url}/9999`)).status, 404, url);
	}
});
