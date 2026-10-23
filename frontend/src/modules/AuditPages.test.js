import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergePages, nextOffset } from "./AuditPages.js";

describe("mergePages", () => {
	it("concatenates pages and drops duplicate ids", () => {
		const pages = [{ data: [{ id: 3 }, { id: 2 }] }, { data: [{ id: 2 }, { id: 1 }] }];
		assert.deepEqual(
			mergePages(pages).map((r) => r.id),
			[3, 2, 1],
		);
	});

	it("handles missing pages", () => {
		assert.deepEqual(mergePages(undefined), []);
	});
});

describe("nextOffset", () => {
	it("returns the loaded count while below the total", () => {
		const pages = [{ data: [{ id: 2 }, { id: 1 }], total: 5 }];
		assert.equal(nextOffset(pages[0], pages), 2);
	});

	it("stops when all rows are loaded", () => {
		const pages = [{ data: [{ id: 2 }, { id: 1 }], total: 2 }];
		assert.equal(nextOffset(pages[0], pages), undefined);
	});

	it("stops when the total is unknown or the page is empty", () => {
		assert.equal(nextOffset({ data: [{ id: 1 }], total: null }, []), undefined);
		assert.equal(nextOffset({ data: [], total: 9 }, []), undefined);
	});
});
