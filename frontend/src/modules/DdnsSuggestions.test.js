import assert from "node:assert/strict";
import { it } from "node:test";
import { recordPrefill, suggestionChoice, suggestionsFor } from "./DdnsSuggestions.js";

const A = { name: "a.example.com", zone: "example.com", dnsCredentialId: 1, credentialName: "Main" };
const B = { name: "b.example.com", zone: "example.com", dnsCredentialId: 2, credentialName: "Other" };

it("picks the suggestions of a host's names, without case, in the host's order", () => {
	assert.deepEqual(suggestionsFor(["B.Example.com", "x.org", "a.example.com"], [A, B]), [B, A]);
});

it("picks each suggestion once and nothing for an empty or missing list", () => {
	assert.deepEqual(suggestionsFor(["a.example.com", "A.EXAMPLE.COM"], [A]), [A]);
	assert.deepEqual(suggestionsFor([], [A]), []);
	assert.deepEqual(suggestionsFor(undefined, [A]), []);
	assert.deepEqual(suggestionsFor(["a.example.com"], undefined), []);
});

it("chooses nothing, the one name or a list", () => {
	assert.deepEqual(suggestionChoice([]), { kind: "none", first: null });
	assert.deepEqual(suggestionChoice(undefined), { kind: "none", first: null });
	assert.deepEqual(suggestionChoice([A]), { kind: "one", first: A });
	assert.deepEqual(suggestionChoice([A, B]), { kind: "many", first: A });
});

it("prefills the record window with the name and the credential", () => {
	assert.deepEqual(recordPrefill(B), { name: "b.example.com", credentialId: 2 });
});
