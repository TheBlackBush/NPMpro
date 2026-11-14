import assert from "node:assert/strict";
import { it } from "node:test";
import { formatApiError, savedOf } from "./ApiError.js";

const messages = { "error.known": "Translated text" };
const has = (id) => id in messages;
const fmt = (id) => messages[id];

it("uses message_i18n when a translation exists", () => {
	const err = { message: "Plain", payload: { error: { message: "Plain", message_i18n: "error.known" } } };
	assert.deepEqual(formatApiError(err, has, fmt), { message: "Translated text", output: null });
});

it("shows plain backend messages as text", () => {
	const err = { message: "Host is already enabled", payload: { error: { message: "Host is already enabled" } } };
	assert.equal(formatApiError(err, has, fmt).message, "Host is already enabled");
});

it("falls back to the plain message when message_i18n has no translation", () => {
	const err = { message: "x", payload: { error: { message: "Readable", message_i18n: "error.unknown" } } };
	assert.equal(formatApiError(err, has, fmt).message, "Readable");
});

it("returns command output separately", () => {
	const err = {
		message: "Internal Error",
		payload: { error: { message: "Internal Error", output: "certbot said no" } },
	};
	assert.deepEqual(formatApiError(err, has, fmt), { message: "Internal Error", output: "certbot said no" });
});

it("handles non API errors", () => {
	assert.equal(formatApiError(new Error("Network down"), has, fmt).message, "Network down");
	assert.equal(formatApiError(null, has, fmt).message, "");
});

it("translates client side errors that carry a translation id", () => {
	assert.equal(formatApiError(new Error("error.known"), has, fmt).message, "Translated text");
	assert.equal(formatApiError(new Error("Network down"), has, fmt).message, "Network down");
});

it("formats a bare HTTP status fallback as a generic request failure", () => {
	const msgs = (id, values) => (id === "error.request-failed" ? `Request failed (HTTP ${values.status})` : id);
	assert.equal(formatApiError(new Error("HTTP 502"), () => false, msgs).message, "Request failed (HTTP 502)");
});

it("passes the values of a translated message", () => {
	const values = { port: 443 };
	const err = { payload: { error: { message: "x", message_i18n: "error.known", message_values: values } } };
	let seen;
	formatApiError(err, has, (id, given) => {
		seen = given;
		return messages[id];
	});
	assert.deepEqual(seen, values);
});

it("reads the row a failed reload saved anyway", () => {
	assert.deepEqual(savedOf({ payload: { error: { saved_id: 7, saved_certificate_id: 3 } } }), {
		id: 7,
		certificateId: 3,
	});
	assert.deepEqual(savedOf({ payload: { error: { saved_id: 7 } } }), { id: 7, certificateId: undefined });
	assert.equal(savedOf({ payload: { error: { message: "x" } } }), null);
	assert.equal(savedOf({ payload: { error: { saved_id: "7" } } }), null);
	assert.equal(savedOf(new Error("x")), null);
	assert.equal(savedOf(null), null);
});
