import assert from "node:assert/strict";
import { it } from "node:test";
import {
	cellClass,
	headerClass,
	mobileRole,
	phoneParts,
	sortOptions,
	sortSelectValue,
	summaryText,
	titleClass,
} from "./MobileColumns.js";

const col = (id, mobile, extra = {}) => ({ id, header: id.toUpperCase(), meta: { mobile, ...extra } });

it("reads the mobile role of a column", () => {
	assert.equal(mobileRole(col("a", "title")), "title");
	assert.equal(mobileRole(col("a", "nonsense")), null);
	assert.equal(mobileRole({ id: "a" }), null);
});

it("hides phone-only roles on phones and keeps them on tablets", () => {
	for (const role of ["title-end", "title-below", "summary", "hide"]) {
		assert.equal(cellClass(col("a", role)), "d-none d-md-table-cell");
		assert.equal(headerClass(col("a", role)), "d-none d-md-table-cell");
	}
	assert.equal(cellClass(col("a", "hide-lg")), "d-none d-lg-table-cell");
	assert.equal(cellClass(col("a", "title")), "");
	assert.equal(cellClass({ id: "a" }), "");
});

it("lets long titles wrap", () => {
	assert.match(titleClass(), /text-break/u);
});

it("joins the summary texts in column order and skips empty ones", () => {
	const columns = [
		col("dest", "summary", { summaryText: (r) => r.dest }),
		col("tls", "summary", { summaryText: () => null }),
		col("acl", "summary", { summaryText: (r) => `${r.acl} access lists` }),
		col("name", "title"),
	];
	assert.equal(
		summaryText(columns, { dest: "http://10.0.0.5:8080", acl: 2 }),
		"http://10.0.0.5:8080 · 2 access lists",
	);
	assert.equal(summaryText([col("x", "summary", { summaryText: () => "" })], {}), "");
});

it("groups the phone parts", () => {
	const columns = [
		col("t", "title"),
		col("m", "title-end"),
		col("s", "title-below"),
		col("d", "summary"),
		col("o", "hide"),
	];
	const parts = phoneParts(columns);
	assert.deepEqual(
		parts.end.map((c) => c.id),
		["m"],
	);
	assert.deepEqual(
		parts.below.map((c) => c.id),
		["s"],
	);
	assert.deepEqual(
		parts.summary.map((c) => c.id),
		["d"],
	);
});

it("offers the sortable columns with a string header", () => {
	const columns = [
		{ id: "a", header: "Name", enableSorting: true },
		{ id: "b", header: "Status", enableSorting: false },
		{ id: "c", header: () => null, enableSorting: true },
		{ id: "d", header: "Created" },
	];
	assert.deepEqual(sortOptions(columns), [
		{ id: "a", label: "Name" },
		{ id: "d", label: "Created" },
	]);
});

it("reads the select value from the sorting state", () => {
	assert.deepEqual(sortSelectValue([{ id: "a", desc: true }]), { id: "a", desc: true });
	assert.deepEqual(sortSelectValue([]), { id: null, desc: false });
});
