import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	accountContext,
	accountOf,
	acmeAccountPayload,
	acmeAddValidate,
	acmeFormValidate,
	acmePayload,
	acmeServerLabel,
	acmeState,
	addChoices,
	addDefaults,
	CUSTOM,
	cardButtonKey,
	cardButtons,
	connectNeedsCheck,
	connectOutcome,
	connectPlan,
	directoryReachable,
	directoryUnreadable,
	eabLockEnv,
	eabShown,
	emailForCa,
	lockedSet,
	messageIsCut,
	otherAccounts,
	otherPlan,
	presetOf,
	profileChoices,
	refusalText,
	replaceDefaults,
	replacePayload,
	saveFailureOf,
	serverKey,
	serverOfForm,
	serverParam,
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

it("marks the EAB key ID when the CA's message is about the binding and a pair was sent", () => {
	const jws = "external account binding JWS verification error: go-jose/go-jose";
	const sent = { eabSent: true };
	assert.equal(saveFailureOf(jws, jws, sent).field, "eabKid");
	assert.equal(saveFailureOf("x", "Error verifying externalAccountBinding JWS", sent).field, "eabKid");
	assert.equal(saveFailureOf("EAB key not found", "EAB key not found", sent).field, "eabKid");
	assert.equal(saveFailureOf("urn:ietf:params:acme:error:unauthorized", "x", sent).field, "eabKid");
	const unknown = "the field 'kid' references a key that is not known to the ACME server";
	assert.equal(saveFailureOf(unknown, `The CA refused: ${unknown}`, sent).field, "eabKid");
	// no pair sent: a general error; a word that only contains eab is no match
	assert.equal(saveFailureOf(jws, jws).field, null);
	assert.equal(saveFailureOf("rebuilt", "rebuilt", sent).field, null);
	assert.equal(saveFailureOf("The CA is down", "The CA is down", sent).field, null);
	// the backend's prefix wins
	assert.equal(saveFailureOf("email: unauthorized", "email: unauthorized", sent).field, "email");
});

it("shows the CA's own sentence in the refused box", () => {
	const refused = (values) => ({ message_i18n: "error.acme-refused", message_values: values });
	assert.equal(refusalText(refused({ message: "bad email" }), "The CA refused: bad email"), "bad email");
	assert.equal(refusalText(refused({}), "shown"), "shown");
	assert.equal(refusalText(refused({ message: "" }), "shown"), "shown");
	assert.equal(refusalText({ message_i18n: "error.acme-url", message_values: { message: "x" } }, "shown"), "shown");
	assert.equal(refusalText(undefined, "shown"), "shown");
});

it("finds an account whatever the case of the scheme and host, not of the path", () => {
	const accounts = [{ server: "https://Ca.LAN:14000/Dir", state: "registered" }];
	assert.equal(accountOf(data({ accounts }), "https://ca.lan:14000/Dir")?.state, "registered");
	assert.equal(accountOf(data({ accounts }), "HTTPS://CA.lan:14000/Dir")?.state, "registered");
	assert.equal(accountOf(data({ accounts }), "https://ca.lan:14000/dir"), null);
	assert.equal(accountOf(data({ accounts }), undefined), null);
});

it("resets the window's email to the picked CA's account email, the env value when locked, else empty", () => {
	const accounts = [
		{ server: ZEROSSL, email: "z@b.c", state: "registered" },
		{ server: PEBBLE, email: null, state: "registered" },
	];
	assert.equal(emailForCa(data({ accounts }), ZEROSSL), "z@b.c");
	assert.equal(emailForCa(data({ accounts }), PEBBLE), "");
	assert.equal(emailForCa(data({ accounts }), LE), "");
	assert.equal(emailForCa(data({ accounts, locked: ["email"], email: "env@b.c" }), ZEROSSL), "env@b.c");
	assert.equal(emailForCa(data({ accounts, locked: ["email"], email: null }), ZEROSSL), "");
});

it("names a query or fragment as the reason a directory URL is refused", () => {
	const check = (customUrl) => acmeFormValidate(rules, data())({ ...toAcmeForm(data()), preset: CUSTOM, customUrl });
	const query = en["error.acme-url-query"];
	assert.equal(check("https://ca.lan/dir?x=1").customUrl, query);
	assert.equal(check("https://ca.lan/dir#frag").customUrl, query);
	assert.equal(check("http://ca.lan/dir").customUrl, en["error.acme-url"]);
	assert.equal(check("https://ca.lan/dir").customUrl, undefined);
});

it("names the env var of a half-locked EAB pair on both fields", () => {
	assert.equal(eabLockEnv({ eabKid: "ACME_EAB_KID" }, "eabHmacKey"), "ACME_EAB_KID");
	assert.equal(eabLockEnv({ eabHmacKey: "H" }, "eabKid"), "H");
	assert.equal(eabLockEnv({ eabKid: "K", eabHmacKey: "H" }, "eabKid"), "K");
	assert.equal(eabLockEnv(undefined, "eabKid"), undefined);
});

it("gives each card state its buttons, Change first on a failed account", () => {
	assert.deepEqual(cardButtons("registered"), [
		{ key: "change", primary: false },
		{ key: "replace", primary: false },
	]);
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

it("takes the instance CA's account the backend matched, also when no listed URL is spelled like the CA", () => {
	// adopted at the start under the backend's key: no trailing slash, no default port
	const own = { server: "https://ca.lan/dir", state: "registered" };
	const upgraded = data({ server: "https://ca.lan:443/dir/", account: own, accounts: [own] });
	assert.equal(accountOf(upgraded, upgraded.server), own);
	assert.equal(accountOf(data({ server: "https://ca.lan/dir/", account: null }), "https://ca.lan/dir/"), null);
	// another CA of the window: the backend's spelling rules
	const other = { server: "https://other.lan/dir", state: "pending" };
	const withOther = data({ account: null, accounts: [other] });
	assert.equal(accountOf(withOther, "https://OTHER.lan:443/dir/"), other);
	const v01 = { server: LE, state: "registered" };
	assert.equal(
		accountOf(
			data({ server: ZEROSSL, account: null, accounts: [v01] }),
			"https://acme-v01.api.letsencrypt.org/directory",
		),
		v01,
	);
});

it("keys a CA URL like the backend", () => {
	assert.equal(serverKey("HTTPS://CA.LAN:443/Dir//"), "https://ca.lan/Dir");
	assert.equal(serverKey("http://step_ca:9000/acme/acme/directory"), "http://step_ca:9000/acme/acme/directory");
	assert.equal(
		serverKey("https://acme-staging.api.letsencrypt.org/directory"),
		"https://acme-staging-v02.api.letsencrypt.org/directory",
	);
	assert.equal(serverKey("not a url"), "not a url");
});

it("names no server for the instance CA in a register or profiles call", () => {
	const http = data({ server: "http://step_ca:9000/acme/acme/directory" });
	assert.equal(serverParam(http, http.server), undefined);
	assert.equal(serverParam(http, ZEROSSL), ZEROSSL);
});

it("keeps one button key for Connect and Change, so the button keeps the focus when the state changes", () => {
	assert.equal(cardButtonKey("connect"), cardButtonKey("change"));
	assert.notEqual(cardButtonKey("retry"), cardButtonKey("change"));
	assert.notEqual(cardButtonKey("replace"), cardButtonKey("change"));
	const window = (kind) => cardButtons(kind).filter(({ key }) => cardButtonKey(key) === "window").length;
	for (const kind of ["registered", "pending", "failed", "none"]) assert.equal(window(kind), 1, kind);
});

const row = (server, extra = {}) => ({ id: 1, server, email: "", state: "registered", ...extra });

it("lists the other CAs' accounts sorted by label, without the instance CA's", () => {
	const settings = data({
		accounts: [
			row(PEBBLE, { id: 3 }),
			row(LE),
			row(ZEROSSL, { id: 2 }),
			row("https://alpha.example/dir", { id: 4 }),
		],
	});
	assert.deepEqual(
		otherAccounts(settings).map((account) => account.id),
		[2, 4, 3],
	);
	assert.deepEqual(
		otherAccounts(settings, (server) => (server === ZEROSSL ? "zzz" : server)).map((account) => account.id),
		[4, 3, 2],
	);
	assert.deepEqual(otherAccounts({ server: LE }), []);
	// the v01 spelling of the instance CA is the same CA
	assert.deepEqual(otherAccounts(data({ accounts: [row("https://acme-v01.api.letsencrypt.org/directory")] })), []);
});

it("offers the presets without a row and not the instance CA, then Custom", () => {
	assert.deepEqual(addChoices(data()), ["letsencrypt-staging", "zerossl", "google", CUSTOM]);
	assert.deepEqual(addChoices(data({ accounts: [row(ZEROSSL)] })), ["letsencrypt-staging", "google", CUSTOM]);
	assert.deepEqual(addChoices({ server: PEBBLE }), [
		"letsencrypt",
		"letsencrypt-staging",
		"zerossl",
		"google",
		CUSTOM,
	]);
	assert.deepEqual(addDefaults(data({ accounts: [row(ZEROSSL)] })), {
		preset: "letsencrypt-staging",
		customUrl: "",
		email: "",
		eabKid: "",
		eabHmacKey: "",
	});
});

it("builds the window's data for an account and for the Add window, with no env lock", () => {
	const settings = data({ locked: ["server", "email"], lockedBy: { email: "ACME_EMAIL" }, accounts: [] });
	const account = row(ZEROSSL, { email: "z@b.c", eabHmacKeySet: true });
	const edit = accountContext(settings, account);
	assert.equal(edit.server, ZEROSSL);
	assert.equal(edit.email, "z@b.c");
	assert.equal(edit.account, account);
	assert.deepEqual(edit.locked, []);
	assert.equal(edit.eabHmacKeySet, true);
	assert.equal(accountContext(settings, row(PEBBLE)).eabHmacKeySet, false);
	const add = accountContext(settings, null);
	assert.equal(add.server, LE);
	assert.deepEqual(add.locked, []);
	assert.deepEqual(add.lockedBy, {});
});

it("sends what an add or an update of another CA's account changes", () => {
	const form = { preset: "zerossl", customUrl: "", email: " a@b.c ", eabKid: " k ", eabHmacKey: " h " };
	assert.deepEqual(acmeAccountPayload(form, null), {
		server: ZEROSSL,
		email: "a@b.c",
		eabKid: "k",
		eabHmacKey: "h",
	});
	assert.deepEqual(acmeAccountPayload({ ...form, email: "", eabKid: "", eabHmacKey: "" }, null), { server: ZEROSSL });
	const account = row(ZEROSSL, { email: "a@b.c" });
	assert.deepEqual(acmeAccountPayload({ ...form, eabKid: "", eabHmacKey: "" }, account), {});
	assert.deepEqual(acmeAccountPayload({ ...form, email: "", eabKid: "", eabHmacKey: "" }, account), { email: "" });
	assert.deepEqual(acmeAccountPayload(form, account), { eabKid: "k", eabHmacKey: "h" });
	// an add sends the pair whole, an update each typed key
	assert.deepEqual(acmeAccountPayload({ ...form, eabHmacKey: "" }, null), { server: ZEROSSL, email: "a@b.c" });
	assert.deepEqual(acmeAccountPayload({ ...form, eabKid: "" }, null), { server: ZEROSSL, email: "a@b.c" });
	assert.deepEqual(acmeAccountPayload({ ...form, eabHmacKey: "" }, account), { eabKid: "k" });
});

it("plans Connect for another CA: add, save, register or nothing", () => {
	const form = { preset: "zerossl", customUrl: "", email: "", eabKid: "", eabHmacKey: "" };
	assert.equal(otherPlan(form, null), "add");
	assert.equal(otherPlan({ ...form, email: "x@y.z" }, row(ZEROSSL)), "save");
	assert.equal(otherPlan(form, row(ZEROSSL)), "nothing");
	assert.equal(otherPlan(form, row(ZEROSSL, { state: "pending" })), "register");
	assert.equal(otherPlan(form, row(ZEROSSL, { state: "failed" })), "register");
});

it("checks the Add window: the card's rules and a required custom URL", () => {
	const validate = acmeAddValidate(rules, data({ accounts: [row(PEBBLE)] }));
	const form = { preset: CUSTOM, customUrl: "", email: "", eabKid: "", eabHmacKey: "" };
	assert.ok(validate(form).customUrl);
	assert.ok(validate({ ...form, customUrl: "http://x.y/dir" }).customUrl);
	assert.ok(validate({ ...form, customUrl: PEBBLE }).customUrl);
	assert.ok(validate({ ...form, customUrl: LE }).customUrl);
	assert.deepEqual(validate({ ...form, customUrl: "https://new.example/dir" }), {});
	assert.deepEqual(validate({ ...form, preset: "zerossl" }), {});
	assert.ok(validate({ ...form, preset: "zerossl", email: "nope" }).email);
	assert.ok(acmeFormValidate(rules, data())({ ...form, customUrl: PEBBLE }));
});
