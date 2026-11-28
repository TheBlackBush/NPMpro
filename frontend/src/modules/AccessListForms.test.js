import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	ACCESS_LIST_TABS,
	accessListDefaults,
	accessListPayload,
	accessListValidate,
	blankRule,
	blankUser,
	commentErrors,
	geoRestrictions,
	ruleErrors,
	ruleRows,
	switchForMode,
	unknownSwitchOn,
	unknownValue,
	userErrors,
	userRows,
} from "./AccessListForms.js";
import { fieldPaths } from "./HookForm.js";
import { tabOfPath } from "./ModalTabs.js";
import { createValidations } from "./ValidationRules.js";

const rules = createValidations(createIntl({ locale: "en", messages: en }));

const newList = { id: 0, name: "", satisfyAny: false, passAuth: false, items: [], clients: [] };
const savedList = {
	id: 3,
	name: "Office",
	satisfyAny: true,
	passAuth: false,
	items: [{ id: 1, accessListId: 3, username: "ann", password: "", createdOn: "x" }],
	clients: [
		{ id: 7, directive: "allow", address: "10.0.0.0/8" },
		{ id: 8, directive: "deny", address: "all" },
	],
};

it("shows one blank user row for a list without users, the saved users with empty passwords", () => {
	assert.deepEqual(userRows([]), [blankUser()]);
	assert.deepEqual(userRows(savedList.items), [{ username: "ann", password: "" }]);
});

it("shows the rules ending with the all rule and at least one row before it", () => {
	assert.deepEqual(ruleRows([]), [blankRule(), { directive: "deny", address: "all", comment: "" }]);
	assert.deepEqual(ruleRows([{ directive: "allow", address: "ALL" }]), [
		blankRule(),
		{ directive: "allow", address: "ALL", comment: "" },
	]);
	assert.deepEqual(ruleRows(savedList.clients), [
		{ directive: "allow", address: "10.0.0.0/8", comment: "" },
		{ directive: "deny", address: "all", comment: "" },
	]);
	assert.deepEqual(ruleRows([{ directive: "allow", address: "1.2.3.4" }]), [
		{ directive: "allow", address: "1.2.3.4", comment: "" },
		{ directive: "deny", address: "all", comment: "" },
	]);
	assert.equal(ruleRows([{ directive: "allow", address: "1.2.3.4", npmproComment: "Office" }])[0].comment, "Office");
});

it("starts a new and a saved list with complete values", () => {
	assert.deepEqual(accessListDefaults(newList), {
		name: "",
		satisfyAny: false,
		passAuth: false,
		items: [blankUser()],
		clients: [blankRule(), { directive: "deny", address: "all", comment: "" }],
		geoMode: "off",
		countries: [],
		geoBlockUnknown: false,
		geoDrop: false,
		npmproDeniedPage: "global",
		npmproDeniedPageHtml: "",
	});
	assert.deepEqual(accessListDefaults(savedList).items, [{ username: "ann", password: "" }]);
});

it("users: the same errors as the Formik rows, blank rows included, one entry per row", () => {
	const saved = new Set(["ann"]);
	assert.deepEqual(
		userErrors(
			rules,
			[
				{ username: "", password: "" },
				{ username: "ann", password: "" },
				{ username: "bob", password: "" },
				{ username: "bob", password: "x".repeat(73) },
				{ username: "a:b", password: "pw" },
			],
			saved,
		),
		[
			null,
			null,
			{ password: "This is required" },
			{ username: "Authorization Usernames must be unique", password: "Maximum length is 72 bytes" },
			{ username: "Up to 255 characters, without : or control characters" },
		],
	);
	assert.equal(userErrors(rules, [{ username: "ann", password: "" }], saved), undefined);
});

it("rules: the same errors as the Formik rows, the last all rule never checked", () => {
	assert.deepEqual(
		ruleErrors(rules, [
			{ directive: "allow", address: "" },
			{ directive: "allow", address: "10.0.0.0/8" },
			{ directive: "allow", address: "example.com" },
			{ directive: "deny", address: "all", comment: "" },
		]),
		[undefined, undefined, { address: "An IPv4/IPv6 address or CIDR range, or unix:" }],
	);
	assert.equal(ruleErrors(rules, ruleRows([])), undefined);
});

it("access list: the same errors as the Formik window and its rows", () => {
	const validate = accessListValidate(rules, { savedUsers: new Set() });
	assert.deepEqual(validate(accessListDefaults(newList)), {
		name: "This is required",
		accessRules: "Either one Authorization or one Access Rule is required",
	});
	assert.deepEqual(
		validate({ ...accessListDefaults(newList), name: "x", items: [{ username: "u", password: "" }] }),
		{
			items: [{ password: "This is required" }],
		},
	);
	assert.deepEqual(
		validate({
			...accessListDefaults(newList),
			name: "x",
			clients: [
				{ directive: "allow", address: "bad host" },
				{ directive: "deny", address: "all", comment: "" },
			],
		}),
		{ clients: [{ address: "An IPv4/IPv6 address or CIDR range, or unix:" }] },
	);
	const editing = accessListValidate(rules, { savedUsers: new Set(["ann"]) });
	assert.deepEqual(editing(accessListDefaults(savedList)), {});
});

it("sends the users with a name and the rules with an address, unchanged rules as saved", () => {
	const values = accessListDefaults(newList);
	const fresh = accessListPayload(
		{ ...values, name: "x", items: [{ username: "u", password: "p" }, blankUser()] },
		[],
	);
	assert.deepEqual(fresh, {
		name: "x",
		satisfyAny: false,
		passAuth: false,
		items: [{ username: "u", password: "p" }],
		clients: [],
		npmproGeoMode: "off",
		npmproGeoUnknown: "auto",
		npmproGeoDrop: false,
		npmproCountries: [],
		npmproDeniedPage: "global",
	});
	const changed = accessListPayload(
		{
			...values,
			clients: [
				{ directive: "allow", address: "1.2.3.4", comment: "" },
				blankRule(),
				{ directive: "deny", address: "all", comment: "" },
			],
		},
		[],
	);
	assert.deepEqual(changed.clients, [
		{ directive: "allow", address: "1.2.3.4", npmproComment: "" },
		{ directive: "deny", address: "all", npmproComment: "" },
	]);
	const saved = accessListPayload(accessListDefaults(savedList), savedList.clients);
	assert.deepEqual(saved.clients, [
		{ directive: "allow", address: "10.0.0.0/8", npmproComment: "" },
		{ directive: "deny", address: "all", npmproComment: "" },
	]);
	assert.deepEqual(saved.items, [{ username: "ann", password: "" }]);
	const allowAll = accessListPayload(
		{
			...accessListDefaults(savedList),
			clients: [
				{ directive: "allow", address: "10.0.0.0/8", comment: "" },
				{ directive: "allow", address: "all", comment: "" },
			],
		},
		savedList.clients,
	);
	assert.deepEqual(allowAll.clients.at(-1), { directive: "allow", address: "all", npmproComment: "" });
});

it("sends the saved rules of a list saved without the all rule when the rules were changed back", () => {
	const saved = [{ directive: "allow", address: "10.0.0.0/8", npmproComment: "" }];
	const values = accessListDefaults({ ...savedList, clients: saved });
	assert.deepEqual(values.clients, [
		{ directive: "allow", address: "10.0.0.0/8", comment: "" },
		{ directive: "deny", address: "all", comment: "" },
	]);
	// the directive changed and changed back, an empty rule added and left empty
	const changedBack = [{ ...values.clients[0] }, blankRule(), { directive: "deny", address: "all", comment: "" }];
	assert.deepEqual(accessListPayload({ ...values, clients: changedBack }, saved).clients, saved);
	assert.deepEqual(accessListPayload(values, saved).clients, saved);
});

it("puts every field of the access list window on exactly one tab, the message asking for a rule on none", () => {
	const misplaced = fieldPaths(accessListDefaults(savedList)).filter(
		(path) => ACCESS_LIST_TABS.filter((tab) => tabOfPath([tab], path) !== null).length !== 1,
	);
	assert.deepEqual(misplaced, []);
	assert.deepEqual(
		ACCESS_LIST_TABS.map((tab) => tab.id),
		["details", "auth", "rules", "countries"],
	);
	assert.equal(
		ACCESS_LIST_TABS.some((tab) => tab.end),
		false,
	);
	assert.equal(tabOfPath(ACCESS_LIST_TABS, "items[0].password"), "auth");
	assert.equal(tabOfPath(ACCESS_LIST_TABS, "clients[1].address"), "rules");
	assert.equal(tabOfPath(ACCESS_LIST_TABS, "countries"), "countries");
	assert.equal(tabOfPath(ACCESS_LIST_TABS, "countries[0].comment"), "countries");
	assert.equal(tabOfPath(ACCESS_LIST_TABS, "geoBlockUnknown"), "countries");
	assert.equal(tabOfPath(ACCESS_LIST_TABS, "accessRules"), null);
});

it("access list: the Denied page's default, tab, errors and payload", () => {
	assert.deepEqual(ACCESS_LIST_TABS[0].fields.slice(-2), ["npmproDeniedPage", "npmproDeniedPageHtml"]);
	const values = accessListDefaults(savedList);
	assert.equal(values.npmproDeniedPage, "global");
	const validate = accessListValidate(rules, { savedUsers: new Set(["ann"]) });
	const custom = { ...values, npmproDeniedPage: "custom" };
	assert.deepEqual(validate(custom), { npmproDeniedPageHtml: "This is required" });
	assert.deepEqual(validate({ ...custom, npmproDeniedPageHtml: "<p>no</p>" }), {});
	const payload = accessListPayload({ ...custom, npmproDeniedPageHtml: "<p>no</p>" }, savedList.clients);
	assert.equal(payload.npmproDeniedPage, "custom");
	assert.equal(payload.npmproDeniedPageHtml, "<p>no</p>");
	const other = accessListPayload({ ...values, npmproDeniedPage: "plain" }, savedList.clients);
	assert.equal(other.npmproDeniedPage, "plain");
	assert.equal("npmproDeniedPageHtml" in other, false);
});

const countryList = {
	...savedList,
	npmproGeoMode: "allow",
	npmproGeoUnknown: "auto",
	npmproGeoDrop: true,
	npmproCountries: [
		{ country: "DE", npmproComment: "Home" },
		{ country: "ZZ", npmproComment: "" },
	],
};

it("the unknown-country switch: what each mode and stored value shows", () => {
	for (const mode of ["off", "allow", "deny"]) {
		assert.equal(unknownSwitchOn(mode, "block"), true);
		assert.equal(unknownSwitchOn(mode, "pass"), false);
		assert.equal(unknownSwitchOn(mode, "auto"), mode === "allow");
	}
});

it("the unknown-country value a save sends: the stored one while off, auto when the switch shows the mode's default", () => {
	for (const saved of ["auto", "pass", "block"]) {
		assert.equal(unknownValue("off", true, saved), saved);
		assert.equal(unknownValue("off", false, saved), saved);
	}
	assert.equal(unknownValue("allow", true, "pass"), "auto");
	assert.equal(unknownValue("allow", false, "auto"), "pass");
	assert.equal(unknownValue("deny", false, "block"), "auto");
	assert.equal(unknownValue("deny", true, "auto"), "block");
});

it("a list saved with auto saves auto again, also after the mode goes allow, deny and back", () => {
	for (const [stored, mode] of [
		["auto", "allow"],
		["auto", "deny"],
		["pass", "allow"],
		["block", "deny"],
	]) {
		const saved = { ...countryList, npmproGeoMode: mode, npmproGeoUnknown: stored };
		const values = accessListDefaults(saved);
		const sent = accessListPayload(values, saved.clients, stored);
		assert.equal(sent.npmproGeoUnknown, stored);
	}
	const values = accessListDefaults(countryList);
	assert.equal(values.geoBlockUnknown, true);
	const flipped = accessListPayload({ ...values, geoMode: "deny" }, countryList.clients, "auto");
	assert.equal(flipped.npmproGeoUnknown, "block");
	const back = accessListPayload({ ...values, geoMode: "allow" }, countryList.clients, "auto");
	assert.equal(back.npmproGeoUnknown, "auto");
});

it("the Countries tab without a database: only Off and the saved mode stay selectable, nothing is added", () => {
	assert.deepEqual(geoRestrictions(countryList, true), { modeLocked: [], canAdd: true });
	assert.deepEqual(geoRestrictions(countryList, false), { modeLocked: ["deny"], canAdd: false });
	assert.deepEqual(geoRestrictions({ ...countryList, npmproGeoMode: "deny" }, false), {
		modeLocked: ["allow"],
		canAdd: false,
	});
	assert.deepEqual(geoRestrictions(newList, false), { modeLocked: ["allow", "deny"], canAdd: false });
	assert.deepEqual(geoRestrictions(undefined, false), { modeLocked: ["allow", "deny"], canAdd: false });
});

it("a saved list with countries opens and saves without a database: a stored code outside the list survives", () => {
	const values = accessListDefaults(countryList);
	assert.deepEqual(values.countries, [
		{ country: "DE", comment: "Home" },
		{ country: "ZZ", comment: "" },
	]);
	assert.equal(values.geoMode, "allow");
	assert.equal(values.geoDrop, true);
	const validate = accessListValidate(rules, { savedUsers: new Set(["ann"]) });
	assert.deepEqual(validate(values), {});
	const sent = accessListPayload(values, countryList.clients, "auto");
	assert.equal(sent.npmproGeoMode, "allow");
	assert.equal(sent.npmproGeoDrop, true);
	assert.deepEqual(sent.npmproCountries, [
		{ country: "DE", npmproComment: "Home" },
		{ country: "ZZ", npmproComment: "" },
	]);
});

it("trims the comments of countries and IP rules, and a changed comment changes the rules", () => {
	const values = accessListDefaults(countryList);
	const padded = accessListPayload(
		{
			...values,
			countries: [{ country: "DE", comment: "  Home  " }],
			clients: values.clients.map((rule, index) => (index === 0 ? { ...rule, comment: " Head office " } : rule)),
		},
		countryList.clients,
		"auto",
	);
	assert.deepEqual(padded.npmproCountries, [{ country: "DE", npmproComment: "Home" }]);
	assert.deepEqual(padded.clients[0], { directive: "allow", address: "10.0.0.0/8", npmproComment: "Head office" });
	const same = accessListPayload(values, countryList.clients, "auto");
	assert.deepEqual(same.clients[0], { directive: "allow", address: "10.0.0.0/8", npmproComment: "" });
	const kept = [{ ...savedList.clients[0], npmproComment: "Head office" }, savedList.clients[1]];
	const untouched = accessListPayload(accessListDefaults({ ...savedList, clients: kept }), kept, "auto");
	assert.equal(untouched.clients[0].npmproComment, "Head office");
});

it("a list with only countries satisfies the user or rule requirement, a mode without countries does not", () => {
	const validate = accessListValidate(rules, { savedUsers: new Set() });
	const base = { ...accessListDefaults(newList), name: "x" };
	assert.deepEqual(validate({ ...base, geoMode: "deny", countries: [{ country: "DE", comment: "" }] }), {});
	assert.deepEqual(validate({ ...base, geoMode: "off", countries: [{ country: "DE", comment: "" }] }), {
		accessRules: "Either one Authorization or one Access Rule is required",
	});
	assert.deepEqual(validate({ ...base, geoMode: "allow", countries: [] }), {
		countries: "Choose at least one country or turn the country rules off",
		accessRules: "Either one Authorization or one Access Rule is required",
	});
});

it("the switch follows the first mode while untouched: a new list set to allow or deny saves auto", () => {
	for (const mode of ["allow", "deny"]) {
		const values = accessListDefaults(newList);
		const switchOn = switchForMode(values.geoMode, mode, values.geoBlockUnknown, { touched: false });
		assert.equal(switchOn, mode === "allow");
		const sent = accessListPayload({ ...values, geoMode: mode, geoBlockUnknown: switchOn }, [], "auto");
		assert.equal(sent.npmproGeoUnknown, "auto");
	}
});

it("the switch after a mode change: a touched switch stays, other changes keep it, the round trip is auto", () => {
	assert.equal(switchForMode("off", "allow", false, { touched: true }), false);
	assert.equal(switchForMode("off", "deny", true, { touched: true }), true);
	// a list saved off with an explicit block: untouched, the first mode's default wins
	const savedOff = accessListDefaults({ ...newList, npmproGeoMode: "off", npmproGeoUnknown: "block" });
	assert.equal(savedOff.geoBlockUnknown, true);
	assert.equal(switchForMode("off", "deny", savedOff.geoBlockUnknown, { touched: false }), false);
	assert.equal(switchForMode("off", "deny", savedOff.geoBlockUnknown, { touched: true }), true);
	assert.equal(accessListPayload({ ...savedOff, geoMode: "off" }, [], "block").npmproGeoUnknown, "block");
	// allow to off keeps the switch
	assert.equal(switchForMode("allow", "off", true, { touched: false }), true);
});

it("the switch follows every mode change until touched: Allow to Block, Block to Allow and the round trip save auto", () => {
	const send = (mode, switchOn) =>
		accessListPayload({ ...accessListDefaults(newList), geoMode: mode, geoBlockUnknown: switchOn }, [], "auto");
	let on = switchForMode("allow", "deny", true, { touched: false });
	assert.equal(on, false);
	assert.equal(send("deny", on).npmproGeoUnknown, "auto");
	on = switchForMode("deny", "allow", false, { touched: false });
	assert.equal(on, true);
	assert.equal(send("allow", on).npmproGeoUnknown, "auto");
	on = switchForMode("allow", "deny", on, { touched: false });
	on = switchForMode("deny", "allow", on, { touched: false });
	assert.equal(send("allow", on).npmproGeoUnknown, "auto");
	// touched: the user's state stays across mode changes
	assert.equal(switchForMode("allow", "deny", true, { touched: true }), true);
	assert.equal(switchForMode("deny", "allow", false, { touched: true }), false);
	// a saved explicit block or pass keeps the switch on a change between allow and deny
	assert.equal(switchForMode("allow", "deny", true, { touched: false, savedUnknown: "block" }), true);
	assert.equal(switchForMode("deny", "allow", false, { touched: false, savedUnknown: "pass" }), false);
});

it("comments: at most 255 characters on rules and countries, a field error each", () => {
	const long = "x".repeat(256);
	const ok = "x".repeat(255);
	assert.equal(commentErrors(rules, [{ comment: ok }, { comment: "" }]), undefined);
	assert.deepEqual(commentErrors(rules, [{ comment: ok }, { comment: long }]), [
		undefined,
		{ comment: "Maximum length is 255 characters" },
	]);
	const validate = accessListValidate(rules, { savedUsers: new Set(["ann"]) });
	const values = accessListDefaults(countryList);
	const rows = values.clients.map((rule, index) => (index === 0 ? { ...rule, comment: long } : rule));
	assert.deepEqual(validate({ ...values, clients: rows }).clients[0], {
		comment: "Maximum length is 255 characters",
	});
	const countries = [{ country: "DE", comment: long }];
	assert.deepEqual(validate({ ...values, countries }).countries, [{ comment: "Maximum length is 255 characters" }]);
	assert.deepEqual(validate({ ...values, clients: [{ ...rows[0], address: "bad host" }, rows[1]] }).clients, [
		{ address: "An IPv4/IPv6 address or CIDR range, or unix:", comment: "Maximum length is 255 characters" },
		undefined,
	]);
});
