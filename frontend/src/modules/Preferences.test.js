import assert from "node:assert/strict";
import { it } from "node:test";
import {
	defaultPageSize,
	pageSizeKey,
	parseCollapsed,
	parseEditorStyle,
	parseNavLayout,
	parsePageSize,
} from "./Preferences.js";

it("navigation layout defaults to the top bar", () => {
	assert.equal(parseNavLayout(null), "top");
	assert.equal(parseNavLayout("rail"), "top");
	assert.equal(parseNavLayout("sidebar"), "sidebar");
});

it("edit windows default to the dialog", () => {
	assert.equal(parseEditorStyle(undefined), "dialog");
	assert.equal(parseEditorStyle("drawer"), "dialog");
	assert.equal(parseEditorStyle("sheet"), "sheet");
});

it("the sidebar is open unless the stored value is exactly 1", () => {
	assert.equal(parseCollapsed(null), false);
	assert.equal(parseCollapsed("true"), false);
	assert.equal(parseCollapsed("1"), true);
});

it("rows per page are one of the five choices, 25 otherwise", () => {
	for (const size of [10, 25, 50, 75, 100]) assert.equal(parsePageSize(String(size)), size);
	for (const value of [null, undefined, "", "abc", "30", "0", "-10", "25.5", "1e2", " 50"]) {
		assert.equal(parsePageSize(value), 25);
	}
});

it("each list has its own key", () => {
	assert.equal(pageSizeKey("proxy-hosts"), "npmpro-page-size-proxy-hosts");
});

it("the stored backups default to 10 rows, every other list to 25", () => {
	assert.equal(defaultPageSize("backups"), 10);
	for (const list of [
		"proxy-hosts",
		"redirection-hosts",
		"dead-hosts",
		"streams",
		"certificates",
		"access-lists",
		"audit-log",
	]) {
		assert.equal(defaultPageSize(list), 25);
	}
	assert.equal(parsePageSize(null, defaultPageSize("backups")), 10);
	assert.equal(parsePageSize("30", defaultPageSize("backups")), 10);
	assert.equal(parsePageSize("50", defaultPageSize("backups")), 50);
});
