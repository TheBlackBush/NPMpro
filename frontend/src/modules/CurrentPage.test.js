import assert from "node:assert/strict";
import { it } from "node:test";
import { domainCovers, servesCurrentPage } from "./CurrentPage.js";

it("matches the same name, whatever its case, spaces, trailing dot or international form", () => {
	assert.equal(domainCovers("npm.example.com", "npm.example.com"), true);
	assert.equal(domainCovers(" NPM.Example.com. ", "npm.example.com"), true);
	assert.equal(domainCovers("bücher.example", "xn--bcher-kva.example"), true);
	assert.equal(domainCovers("10.0.0.5", "10.0.0.5"), true);
	assert.equal(domainCovers("npm.example.com", "example.com"), false);
	assert.equal(domainCovers("example.com", "npm.example.com"), false);
	assert.equal(domainCovers("npm.example.co", "npm.example.com"), false);
});

it("lets a *. wildcard cover every name below its domain, not the domain itself", () => {
	assert.equal(domainCovers("*.example.com", "npm.example.com"), true);
	assert.equal(domainCovers("*.example.com", "a.b.example.com"), true);
	assert.equal(domainCovers("*.Example.com", "NPM.example.com"), true);
	assert.equal(domainCovers("*.bücher.example", "npm.xn--bcher-kva.example"), true);
	assert.equal(domainCovers("*.example.com", "example.com"), false);
	assert.equal(domainCovers("*.example.com", "npmexample.com"), false);
	assert.equal(domainCovers("*.example.com", "npm.example.org"), false);
});

it("lets nginx's .example.com cover the domain and every name below it", () => {
	assert.equal(domainCovers(".example.com", "example.com"), true);
	assert.equal(domainCovers(".example.com", "npm.example.com"), true);
	assert.equal(domainCovers(".example.com", "npmexample.com"), false);
});

it("never matches a regular expression, a wildcard at the end, an empty name or an empty address", () => {
	assert.equal(domainCovers("~^npm\\.example\\.com$", "npm.example.com"), false);
	assert.equal(domainCovers("npm.example.*", "npm.example.com"), false);
	assert.equal(domainCovers("", "npm.example.com"), false);
	assert.equal(domainCovers("npm.example.com", ""), false);
	assert.equal(domainCovers(undefined, undefined), false);
});

it("checks every domain name of a host", () => {
	assert.equal(servesCurrentPage(["a.example.com", "*.example.org"], "npm.example.org"), true);
	assert.equal(servesCurrentPage(["a.example.com", "b.example.com"], "npm.example.org"), false);
	assert.equal(servesCurrentPage([], "npm.example.org"), false);
	assert.equal(servesCurrentPage(undefined, "npm.example.org"), false);
});
