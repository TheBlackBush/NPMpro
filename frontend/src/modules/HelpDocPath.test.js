import assert from "node:assert/strict";
import { it } from "node:test";
import { helpDocPath } from "./HelpDocPath.js";

const available = {
	"../../translations/help/en/Proxy.md": () => {},
	"../../translations/help/de/Proxy.md": () => {},
	"../../translations/help/en/Only.md": () => {},
};

it("returns the path of the locale's document", () => {
	assert.equal(helpDocPath("de", "Proxy", available), "../../translations/help/de/Proxy.md");
});

it("falls back to the English document", () => {
	assert.equal(helpDocPath("fr", "Proxy", available), "../../translations/help/en/Proxy.md");
	assert.equal(helpDocPath("de", "Only", available), "../../translations/help/en/Only.md");
});

it("returns null when neither exists", () => {
	assert.equal(helpDocPath("de", "Missing", available), null);
});

it("does not match inherited object keys", () => {
	assert.equal(helpDocPath("en", "constructor", {}), null);
});
