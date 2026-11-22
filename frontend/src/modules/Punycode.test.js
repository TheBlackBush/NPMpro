import assert from "node:assert/strict";
import { it } from "node:test";
import { decodePunycode, isValidAceLabel, toAscii } from "./Punycode.js";

it("decodes a punycode payload", () => {
	assert.equal(decodePunycode("bcher-kva"), "bücher");
	assert.equal(decodePunycode("maana-pta"), "mañana");
	assert.equal(decodePunycode("n3h"), "☃");
	assert.equal(decodePunycode("egbpdaj6bu4bxfgehfvwxn"), "ليهمابتكلموشعربي؟");
});

it("refuses a payload that does not decode", () => {
	assert.equal(decodePunycode(""), null);
	assert.equal(decodePunycode(undefined), null);
	assert.equal(decodePunycode("a".repeat(60)), null);
	assert.equal(decodePunycode("bücher-kva"), null);
	assert.equal(decodePunycode("a!"), null);
	assert.equal(decodePunycode("99999999999999999999"), null);
	assert.equal(decodePunycode("9"), null);
});

it("accepts an xn-- label of a real IDN and refuses the others", () => {
	assert.equal(isValidAceLabel("xn--bcher-kva"), true);
	assert.equal(isValidAceLabel("xn--a"), false);
	assert.equal(isValidAceLabel("xn--"), false);
	assert.equal(isValidAceLabel(`xn--${"a".repeat(60)}`), false);
	assert.equal(isValidAceLabel("xn--abc-"), false);
	// symbols and emoji are IDN labels too, as the backend's domainToUnicode round trip has them
	assert.equal(isValidAceLabel("xn--n3h"), true);
	assert.equal(isValidAceLabel("xn--i-7iq"), true);
	assert.equal(isValidAceLabel("xn--e28h"), true);
	// joiners and a label the URL rules write another way are not
	assert.equal(isValidAceLabel("xn--0ug"), false);
	assert.equal(isValidAceLabel("xn--1ug"), false);
	assert.equal(isValidAceLabel("xn--ab-m1t"), false);
});

it("turns a host into the form a browser stores", () => {
	assert.equal(toAscii("Bücher.DE"), "xn--bcher-kva.de");
	assert.equal(toAscii("a b"), "");
});
