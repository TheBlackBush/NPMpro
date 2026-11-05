import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { deleteCookie, getCookie } from "./Cookies.js";

const realDocument = globalThis.document;
afterEach(() => {
	globalThis.document = realDocument;
});

it("expires a __Host- cookie with the attributes the prefix requires", () => {
	const written = [];
	globalThis.document = {
		get cookie() {
			return "";
		},
		set cookie(value) {
			written.push(value);
		},
	};
	deleteCookie("__Host-npmpro_oidc_no_redirect");
	assert.deepEqual(written, ["__Host-npmpro_oidc_no_redirect=; Max-Age=0; Path=/; Secure; SameSite=Strict"]);
});

it("reads a cookie by name", () => {
	globalThis.document = { cookie: "a=1; __Host-npmpro_oidc_totp_required=true" };
	assert.equal(getCookie("__Host-npmpro_oidc_totp_required"), "true");
	assert.equal(getCookie("missing"), undefined);
});
