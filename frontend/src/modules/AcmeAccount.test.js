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
	cardButtons,
	connectNeedsCheck,
	connectOutcome,
	connectPlan,
	directoryReachable,
	directoryUnreadable,
	eabLockEnv,
	eabShown,
	lockedSet,
	messageIsCut,
	presetOf,
	profileChoices,
	replaceDefaults,
	replacePayload,
	saveFailureOf,
	serverOfForm,
	toAcmeForm,
	visibleEabValues,
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

it("describes the account state", () => {
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
});

it("offers the CA's profiles with Server default, keeps a stored profile it no longer lists, else free text", () => {
	const result = { reachable: true, directory: true, profiles: [{ name: "classic", description: "Classic" }] };
	assert.deepEqual(profileChoices({ result, stored: "tlsserver" }), {
		mode: "select",
		options: [
			{ value: "", labelId: "settings.certificates.profile.placeholder" },
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
	assert.equal(replaceDefaults({ email: "old@b.c" }, data({ locked: ["email"], email: "env@b.c" })).email, "env@b.c");
	assert.equal(replaceDefaults({ email: "old@b.c" }, data({ email: "env@b.c" })).email, "old@b.c");
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
	assert.deepEqual(
		Object.keys(validate({ ...same, customUrl: "http://x", email: "no-at" })).sort((a, b) => a.localeCompare(b)),
		["customUrl", "email"],
	);
	assert.deepEqual(validate({ ...same, customUrl: "https://ca.example/dir", email: "" }), {});
	assert.deepEqual(validate({ preset: "zerossl", customUrl: "junk", email: "x@y.z" }), {});
});

it("splits a field prefix off a failed save", () => {
	assert.deepEqual(saveFailureOf("email: bad", "email: bad"), { message: "bad", field: "email" });
	assert.deepEqual(saveFailureOf("eab: x", "Needs a pair"), { message: "Needs a pair", field: "eabKid" });
	assert.deepEqual(saveFailureOf("plain", "server: translated"), { message: "translated", field: "customUrl" });
	assert.deepEqual(saveFailureOf("", "nginx failed"), { message: "nginx failed", field: null });
	assert.deepEqual(saveFailureOf(undefined, "a\nserver: b"), { message: "a\nserver: b", field: null });
});

it("names the env var of a half-locked EAB pair on both fields", () => {
	assert.equal(eabLockEnv({ eabKid: "ACME_EAB_KID" }, "eabHmacKey"), "ACME_EAB_KID");
	assert.equal(eabLockEnv({ eabHmacKey: "H" }, "eabKid"), "H");
	assert.equal(eabLockEnv({ eabKid: "K", eabHmacKey: "H" }, "eabKid"), "K");
	assert.equal(eabLockEnv(undefined, "eabKid"), undefined);
});

it("gives each card state its buttons, Change first on a failed account", () => {
	assert.deepEqual(cardButtons("registered"), [{ key: "change", primary: false }]);
	assert.deepEqual(
		cardButtons("pending").map((b) => b.key),
		["retry", "change"],
	);
	assert.deepEqual(cardButtons("failed"), [
		{ key: "change", primary: true },
		{ key: "retry", primary: false },
	]);
	assert.deepEqual(cardButtons("none"), [{ key: "connect", primary: true }]);
});

it("plans Connect: nothing, a register of the stored account, or a save", () => {
	const registered = data({ accounts: [{ server: LE, state: "registered" }] });
	const form = toAcmeForm(registered);
	assert.equal(connectPlan(form, registered), "nothing");
	assert.equal(connectPlan({ ...form, email: "x@y.z" }, registered), "save");
	const failed = data({ accounts: [{ server: LE, state: "failed" }] });
	assert.equal(connectPlan(toAcmeForm(failed), failed), "register");
	assert.equal(connectPlan({ ...toAcmeForm(failed), eabKid: "k" }, failed), "save");
	assert.equal(connectPlan(toAcmeForm(data()), data()), "register");
});

it("reads the directory before Connect only for a changed CA or an account that is not registered", () => {
	const registered = data({ accounts: [{ server: LE, state: "registered" }] });
	const form = toAcmeForm(registered);
	assert.equal(connectNeedsCheck(form, registered), false);
	assert.equal(connectNeedsCheck({ ...form, email: "x@y.z" }, registered), false);
	assert.equal(connectNeedsCheck({ ...form, preset: "zerossl" }, registered), true);
	const pending = data({ accounts: [{ server: LE, state: "pending" }] });
	assert.equal(connectNeedsCheck(toAcmeForm(pending), pending), true);
});

it("maps answers to outcomes and tells an unreadable directory", () => {
	assert.equal(connectOutcome({ warning: "unreachable" }), "waiting");
	assert.equal(connectOutcome({}), "connected");
	assert.equal(connectOutcome(undefined), "connected");
	assert.equal(directoryReachable({ reachable: true }), true);
	assert.equal(directoryReachable({ reachable: false }), false);
	assert.equal(directoryReachable(undefined), false);
	const base = { custom: true, probed: true };
	assert.equal(directoryUnreadable({ ...base, error: new Error("x") }), true);
	assert.equal(directoryUnreadable({ ...base, result: { reachable: false } }), true);
	assert.equal(directoryUnreadable({ ...base, result: { reachable: true } }), false);
	assert.equal(directoryUnreadable({ ...base }), false);
	assert.equal(directoryUnreadable({ custom: false, probed: true, error: new Error("x") }), false);
	assert.equal(directoryUnreadable({ custom: true, probed: false, error: new Error("x") }), false);
});

it("does not offer the EAB switch for a registered account, empties hidden EAB values, cuts only long messages", () => {
	const base = { custom: true, probed: true, error: new Error("x") };
	assert.equal(directoryUnreadable({ ...base, account: { state: "registered" } }), false);
	assert.equal(directoryUnreadable({ ...base, account: { state: "failed" } }), true);
	const values = { preset: "letsencrypt", eabKid: "k", eabHmacKey: "h", email: "a@b.c" };
	assert.deepEqual(visibleEabValues(values, true), values);
	assert.deepEqual(visibleEabValues(values, false), { ...values, eabKid: "", eabHmacKey: "" });
	assert.equal(messageIsCut("short one"), false);
	assert.equal(messageIsCut("two\nlines"), true);
	assert.equal(messageIsCut("x".repeat(61)), true);
});
