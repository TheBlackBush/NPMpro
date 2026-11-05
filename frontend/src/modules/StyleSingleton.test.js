import assert from "node:assert/strict";
import { it } from "node:test";
import { stylesheetSingleton } from "./StyleSingleton.js";

// a document with constructed stylesheets, as the browser's
const fakeDocument = () => {
	class FakeSheet {
		replaceSync(text) {
			this.text = text;
		}
	}
	return { adoptedStyleSheets: [], defaultView: { CSSStyleSheet: FakeSheet } };
};

it("adds the styles once as a constructed stylesheet and removes them with the last user", () => {
	const doc = fakeDocument();
	const other = { text: "kept" };
	doc.adoptedStyleSheets = [other];
	const singleton = stylesheetSingleton(doc);
	singleton.add("body { overflow: hidden }");
	singleton.add("ignored while the first is in place");
	assert.deepEqual(
		doc.adoptedStyleSheets.map((sheet) => sheet.text),
		["kept", "body { overflow: hidden }"],
	);
	singleton.remove();
	assert.equal(doc.adoptedStyleSheets.length, 2);
	singleton.remove();
	assert.deepEqual(doc.adoptedStyleSheets, [other]);
	// added again after it was removed
	singleton.add("b {}");
	assert.equal(doc.adoptedStyleSheets.at(-1).text, "b {}");
});

it("keeps one stylesheet per singleton", () => {
	const doc = fakeDocument();
	const first = stylesheetSingleton(doc);
	const second = stylesheetSingleton(doc);
	first.add("a {}");
	second.add("b {}");
	first.remove();
	assert.deepEqual(
		doc.adoptedStyleSheets.map((sheet) => sheet.text),
		["b {}"],
	);
});
