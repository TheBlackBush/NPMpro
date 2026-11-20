import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	accountOf,
	acmeFormValidate,
	acmePayload,
	acmeServerLabel,
	acmeState,
	CUSTOM,
	canRegisterNow,
	eabShown,
	lockedSet,
	presetOf,
	profileChoices,
	replaceDefaults,
	replacePayload,
	serverOfForm,
	toAcmeForm,
} from "./AcmeAccount.js";
import { createValidations } from "./ValidationRules.js";

const rules = createValidations(createIntl({ locale: "en", messages: en }));
const LE = "https://acme-v02.api.letsencrypt.org/directory";
const ZEROSSL = "https://acme.zerossl.com/v2/DV90";
const PEBBLE = "https://pebble:14000/dir";
const data = (extra = {}) => ({ server: LE, email: "a@b.c", locked: [], accounts: [], ...extra });

it("maps presets and custom URLs both ways", () => {
	assert.equal(presetOf(ZEROSSL), "zerossl");
	assert.equal(presetOf(PEBBLE), CUSTOM);
	assert.deepEqual(toAcmeForm(data({ server: PEBBLE })), {
		preset: CUSTOM,
		customUrl: PEBBLE,
		email: "a@b.c",
		eabKid: "",
		eabHmacKey: "",
	});
	assert.equal(toAcmeForm({ server: LE, email: null }).email, "");
	assert.equal(serverOfForm({ preset: "google", customUrl: "" }), "https://dv.acme-v02.api.pki.goog/directory");
	assert.equal(serverOfForm({ preset: CUSTOM, customUrl: ` ${PEBBLE} ` }), PEBBLE);
	assert.deepEqual(acmeServerLabel(ZEROSSL), { labelId: "acme.preset.zerossl" });
	assert.deepEqual(acmeServerLabel(PEBBLE), { text: "pebble:14000" });
	assert.deepEqual(acmeServerLabel("not a url"), { text: "not a url" });
});

it("sends only changed, unlocked keys; a CA changed back is no change; empty EAB keeps", () => {
	const form = { ...toAcmeForm(data()), email: "a@b.c" };
	assert.deepEqual(acmePayload(form, data()), {});
	assert.deepEqual(acmePayload({ ...form, preset: "zerossl" }, data()), { server: ZEROSSL });
	assert.deepEqual(acmePayload({ ...form, preset: "letsencrypt" }, data()), {});
	assert.deepEqual(acmePayload({ ...form, email: " x@y.z ", eabKid: "k", eabHmacKey: "" }, data()), {
		email: "x@y.z",
		eabKid: "k",
	});
	assert.deepEqual(acmePayload({ ...form, eabHmacKey: " h " }, data({ email: null })), {
		email: "a@b.c",
		eabHmacKey: "h",
	});
});

it("locked keys never reach the payload, and the EAB pair locks together", () => {
	const locked = data({ locked: ["server", "eab_hmac_key"] });
	assert.deepEqual(
		[...lockedSet(locked.locked)].sort((a, b) => a.localeCompare(b)),
		["eabHmacKey", "eabKid", "server"],
	);
	assert.deepEqual(
		acmePayload({ preset: CUSTOM, customUrl: PEBBLE, email: "a@b.c", eabKid: "k", eabHmacKey: "h" }, locked),
		{},
	);
	assert.deepEqual(
		[...lockedSet(["eab_kid", "email"])].sort((a, b) => a.localeCompare(b)),
		["eabHmacKey", "eabKid", "email"],
	);
	assert.deepEqual([...lockedSet(undefined)], []);
	const emailLocked = data({ locked: ["email"] });
	assert.deepEqual(acmePayload({ ...toAcmeForm(emailLocked), email: "other@b.c" }, emailLocked), {});
});

it("finds the account of a server", () => {
	const account = { server: ZEROSSL, state: "registered" };
	assert.equal(accountOf(data({ accounts: [{ server: LE }, account] }), ZEROSSL), account);
	assert.equal(accountOf(data({ accounts: [{ server: LE }] }), ZEROSSL), null);
	assert.equal(accountOf({ server: LE }, LE), null);
});

it("shows the EAB fields for a CA that requires them until its account is registered", () => {
	assert.equal(eabShown({ preset: "zerossl", externalAccountRequired: null, account: null }), true);
	assert.equal(eabShown({ preset: CUSTOM, externalAccountRequired: true, account: { state: "pending" } }), true);
	assert.equal(
		eabShown({ preset: "google", externalAccountRequired: true, account: { state: "registered" } }),
		false,
	);
	assert.equal(eabShown({ preset: "letsencrypt", externalAccountRequired: false, account: null }), false);
});

it("describes the account state and when Register now is offered", () => {
	assert.deepEqual(acmeState(null), { kind: "none" });
	assert.deepEqual(acmeState({ state: "registered", registeredOn: "2026-11-19 10:00:00", email: "", error: null }), {
		kind: "registered",
		date: "2026-11-19 10:00:00",
		email: null,
		error: null,
	});
	assert.deepEqual(acmeState({ state: "registered", registeredOn: "d", email: "a@b.c" }), {
		kind: "registered",
		date: "d",
		email: "a@b.c",
		error: null,
	});
	assert.deepEqual(acmeState({ state: "pending", error: "later" }), { kind: "pending", error: "later" });
	assert.deepEqual(acmeState({ state: "pending" }), { kind: "pending", error: null });
	assert.deepEqual(acmeState({ state: "failed", modifiedOn: "2026-11-19 11:00:00", error: "refused" }), {
		kind: "failed",
		date: "2026-11-19 11:00:00",
		error: "refused",
	});
	assert.deepEqual(acmeState({ state: "failed", modifiedOn: "d" }), { kind: "failed", date: "d", error: null });
	assert.equal(canRegisterNow(null), true);
	assert.equal(canRegisterNow({ state: "pending" }), true);
	assert.equal(canRegisterNow({ state: "registered" }), false);
});

it("offers the CA's profiles with Server default, keeps a stored profile it no longer lists, else free text", () => {
	const result = { reachable: true, directory: true, profiles: [{ name: "classic", description: "Classic" }] };
	assert.deepEqual(profileChoices({ result, stored: "tlsserver" }), {
		mode: "select",
		options: [
			{ value: "", labelId: "settings.certificates.profile.server-default" },
			{ value: "classic", label: "classic", description: "Classic" },
			{ value: "tlsserver", label: "tlsserver", missing: true },
		],
	});
	assert.equal(profileChoices({ result, stored: "classic" }).options.length, 2);
	assert.equal(profileChoices({ result, stored: "" }).options.length, 2);
	assert.deepEqual(profileChoices({ result: { reachable: false }, stored: "" }), { mode: "text" });
	assert.deepEqual(profileChoices({ result: { reachable: true, directory: false }, stored: "" }), { mode: "text" });
	assert.deepEqual(profileChoices({ result: undefined, stored: "" }), { mode: "text" });
});

it("starts the Replace window with the current email and the deactivate switch off", () => {
	assert.deepEqual(replaceDefaults({ email: "a@b.c" }), {
		email: "a@b.c",
		eabKid: "",
		eabHmacKey: "",
		deactivateOld: false,
	});
	assert.equal(replaceDefaults(null).email, "");
	assert.deepEqual(replacePayload(ZEROSSL, { email: " a@b.c ", eabKid: "", eabHmacKey: "", deactivateOld: true }), {
		server: ZEROSSL,
		email: "a@b.c",
		deactivateOld: true,
	});
	assert.deepEqual(replacePayload(ZEROSSL, { email: "", eabKid: " k ", eabHmacKey: " h ", deactivateOld: false }), {
		server: ZEROSSL,
		email: "",
		deactivateOld: false,
		eabKid: "k",
		eabHmacKey: "h",
	});
});

it("checks a custom URL and an email only when they differ from the saved ones", () => {
	const saved = data({ server: PEBBLE, email: "bad" });
	const validate = acmeFormValidate(rules, saved);
	const same = { preset: CUSTOM, customUrl: PEBBLE, email: "bad" };
	assert.deepEqual(validate(same), {});
	assert.deepEqual(Object.keys(validate({ ...same, customUrl: "http://x", email: "no-at" })).sort(), [
		"customUrl",
		"email",
	]);
	assert.deepEqual(validate({ ...same, customUrl: "https://ca.example/dir", email: "" }), {});
	assert.deepEqual(validate({ preset: "zerossl", customUrl: "junk", email: "x@y.z" }), {});
});
