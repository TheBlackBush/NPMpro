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
	ruleErrors,
	ruleRows,
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
	assert.deepEqual(ruleRows([]), [blankRule(), { directive: "deny", address: "all" }]);
	assert.deepEqual(ruleRows([{ directive: "allow", address: "ALL" }]), [
		blankRule(),
		{ directive: "allow", address: "ALL" },
	]);
	assert.deepEqual(ruleRows(savedList.clients), [
		{ directive: "allow", address: "10.0.0.0/8" },
		{ directive: "deny", address: "all" },
	]);
	assert.deepEqual(ruleRows([{ directive: "allow", address: "1.2.3.4" }]), [
		{ directive: "allow", address: "1.2.3.4" },
		{ directive: "deny", address: "all" },
	]);
});

it("starts a new and a saved list with complete values", () => {
	assert.deepEqual(accessListDefaults(newList), {
		name: "",
		satisfyAny: false,
		passAuth: false,
		items: [blankUser()],
		clients: [blankRule(), { directive: "deny", address: "all" }],
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
			{ directive: "deny", address: "all" },
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
				{ directive: "deny", address: "all" },
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
	});
	const changed = accessListPayload(
		{
			...values,
			clients: [{ directive: "allow", address: "1.2.3.4" }, blankRule(), { directive: "deny", address: "all" }],
		},
		[],
	);
	assert.deepEqual(changed.clients, [
		{ directive: "allow", address: "1.2.3.4" },
		{ directive: "deny", address: "all" },
	]);
	const saved = accessListPayload(accessListDefaults(savedList), savedList.clients);
	assert.deepEqual(saved.clients, [
		{ directive: "allow", address: "10.0.0.0/8" },
		{ directive: "deny", address: "all" },
	]);
	assert.deepEqual(saved.items, [{ username: "ann", password: "" }]);
	const allowAll = accessListPayload(
		{
			...accessListDefaults(savedList),
			clients: [{ ...savedList.clients[0] }, { directive: "allow", address: "all" }],
		},
		savedList.clients,
	);
	assert.deepEqual(allowAll.clients.at(-1), { directive: "allow", address: "all" });
});

it("sends the saved rules of a list saved without the all rule when the rules were changed back", () => {
	const saved = [{ directive: "allow", address: "10.0.0.0/8" }];
	const values = accessListDefaults({ ...savedList, clients: saved });
	assert.deepEqual(values.clients, [
		{ directive: "allow", address: "10.0.0.0/8" },
		{ directive: "deny", address: "all" },
	]);
	// the directive changed and changed back, an empty rule added and left empty
	const changedBack = [{ ...values.clients[0] }, blankRule(), { directive: "deny", address: "all" }];
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
		["details", "auth", "rules"],
	);
	assert.equal(
		ACCESS_LIST_TABS.some((tab) => tab.end),
		false,
	);
	assert.equal(tabOfPath(ACCESS_LIST_TABS, "items[0].password"), "auth");
	assert.equal(tabOfPath(ACCESS_LIST_TABS, "clients[1].address"), "rules");
	assert.equal(tabOfPath(ACCESS_LIST_TABS, "accessRules"), null);
});
