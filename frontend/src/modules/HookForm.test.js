import assert from "node:assert/strict";
import { it } from "node:test";
import {
	applyChanges,
	controlNames,
	errorPaths,
	fieldPaths,
	fieldsValidate,
	formResolver,
	mergeErrors,
	orderErrorPaths,
	resetOptionsOf,
	rowErrorPaths,
	setIn,
	toHookFormErrors,
	translateErrors,
} from "./HookForm.js";

it("sets a value at a path, with lists for numeric parts", () => {
	assert.deepEqual(setIn({}, "name", "x"), { name: "x" });
	assert.deepEqual(setIn({ a: { b: 1 } }, "a.c", 2), { a: { b: 1, c: 2 } });
	const list = setIn({}, "items[1].username", "x");
	assert.equal(Array.isArray(list.items), true);
	assert.equal(list.items.length, 2);
	assert.deepEqual(list.items[1], { username: "x" });
	const before = { a: { b: 1 } };
	setIn(before, "a.b", 2);
	assert.deepEqual(before, { a: { b: 1 } });
});

it("merges errors with the later one winning a field", () => {
	assert.deepEqual(mergeErrors({ confirm: "Too short", new: "Too short" }, { confirm: "Must match" }), {
		confirm: "Must match",
		new: "Too short",
	});
	assert.deepEqual(mergeErrors({ fieldValues: { a: "A" } }, { fieldValues: { b: "B" } }), {
		fieldValues: { a: "A", b: "B" },
	});
	assert.deepEqual(mergeErrors({ a: "A" }, undefined, {}), { a: "A" });
});

it("builds a validate from field rules and a rule over the form", () => {
	const required = (value) => (value ? undefined : "Required");
	const validate = fieldsValidate({ name: required, "fieldValues.token": required, skipped: undefined }, (values) =>
		values.name === "taken" ? { name: "Taken" } : {},
	);
	assert.deepEqual(validate({ name: "", fieldValues: {} }), {
		name: "Required",
		fieldValues: { token: "Required" },
	});
	assert.deepEqual(validate({ name: "taken", fieldValues: { token: "t" } }), { name: "Taken" });
	assert.deepEqual(validate({ name: "ok", fieldValues: { token: "t" } }), {});
	const conditional = fieldsValidate((values) => (values.on ? { extra: required } : {}));
	assert.deepEqual(conditional({ on: false }), {});
	assert.deepEqual(conditional({ on: true }), { extra: "Required" });
});

it("translates message ids", () => {
	const intl = { formatMessage: ({ id }) => `text of ${id}` };
	assert.deepEqual(translateErrors({ name: "a.b" }, intl), { name: "text of a.b" });
});

it("gives React Hook Form's error shape", () => {
	assert.deepEqual(toHookFormErrors({ name: "Required", fieldValues: { token: "Bad" } }), {
		name: { type: "validate", message: "Required" },
		fieldValues: { token: { type: "validate", message: "Bad" } },
	});
	assert.equal(toHookFormErrors({}), undefined);
	assert.equal(toHookFormErrors({ name: "" }), undefined);
});

it("resolves to the values when validate finds nothing, else to the errors", async () => {
	const resolver = formResolver((values) => (values.name ? {} : { name: "Required" }));
	assert.deepEqual(await resolver({ name: "x" }), { values: { name: "x" }, errors: {} });
	assert.deepEqual(await resolver({ name: "" }), {
		values: {},
		errors: { name: { type: "validate", message: "Required" } },
	});
	const asyncResolver = formResolver(async () => ({ name: "Later" }));
	assert.deepEqual((await asyncResolver({})).errors, { name: { type: "validate", message: "Later" } });
});

it("lists the path of every error in either library's shape", () => {
	assert.deepEqual(errorPaths({ name: "A", fieldValues: { token: "B" }, items: [undefined, { path: "C" }] }), [
		"name",
		"fieldValues.token",
		"items[1].path",
	]);
	assert.deepEqual(
		errorPaths({
			name: { type: "validate", message: "A" },
			fieldValues: { type: { type: "validate", message: "B" } },
			root: { type: "server", message: "C" },
		}),
		["name", "fieldValues.type"],
	);
	assert.deepEqual(errorPaths({}), []);
});

it("lists the fields of a form in the order of its defaultValues", () => {
	assert.deepEqual(
		fieldPaths({
			name: "",
			provider: "",
			fieldValues: { token: "", zone: "" },
			domainNames: [],
			certificate: null,
			empty: {},
		}),
		["name", "provider", "fieldValues.token", "fieldValues.zone", "domainNames", "certificate", "empty"],
	);
});

it("orders errors by the form's fields, so the note and the focus follow the form", () => {
	const order = ["name", "frequency", "monthDay", "time", "types", "keep"];
	assert.deepEqual(orderErrorPaths(["keep", "types", "name"], order), ["name", "types", "keep"]);
	assert.deepEqual(orderErrorPaths(["time", "monthDay"], order), ["monthDay", "time"]);
	assert.deepEqual(orderErrorPaths(["fieldValues.zone", "other", "name"], ["name", "fieldValues"]), [
		"name",
		"fieldValues.zone",
		"other",
	]);
	assert.deepEqual(orderErrorPaths([], order), []);
});

it("merges the errors of a list row by row, so a rule over the form keeps the rows' messages", () => {
	assert.deepEqual(
		mergeErrors({ items: [undefined, { username: "Taken" }] }, { items: [{ password: "Required" }], name: "N" }),
		{ items: [{ password: "Required" }, { username: "Taken" }], name: "N" },
	);
	assert.deepEqual(mergeErrors({ items: [{ username: "A" }] }, { items: [{ username: "B" }] }), {
		items: [{ username: "B" }],
	});
	const fromRules = fieldsValidate({ "locations[1].path": () => "Required" }, () => ({
		locations: [{ forwardHost: "Invalid" }],
	}));
	assert.deepEqual(fromRules({}), { locations: [{ forwardHost: "Invalid" }, { path: "Required" }] });
});

it("names a field's control by its error path and by its register name", () => {
	assert.deepEqual(controlNames("domainNames"), ["domainNames"]);
	assert.deepEqual(controlNames("locations[0].path"), ["locations[0].path", "locations.0.path"]);
	assert.deepEqual(controlNames("clients[10].address"), ["clients[10].address", "clients.10.address"]);
});

it("lists the rows of a list whose field holds a message", () => {
	const errors = [undefined, { path: { type: "validate", message: "Duplicate" } }, { forwardHost: {} }];
	assert.deepEqual(rowErrorPaths(errors, "locations", "path"), ["locations.1.path"]);
	assert.deepEqual(rowErrorPaths(undefined, "locations", "path"), []);
	assert.deepEqual(rowErrorPaths({ type: "validate" }, "locations", "path"), []);
});

it("sets every field of a change map in its order, dirty, under a row's path when given", () => {
	const calls = [];
	const setValue = (...args) => calls.push(args);
	applyChanges(setValue, { forwardScheme: "path", npmproFancyindex: false });
	applyChanges(setValue, { npmproAuthRequestUpstream: "" }, "locations.2");
	assert.deepEqual(calls, [
		["forwardScheme", "path", { shouldDirty: true }],
		["npmproFancyindex", false, { shouldDirty: true }],
		["locations.2.npmproAuthRequestUpstream", "", { shouldDirty: true }],
	]);
});

it("keeps the edited fields when new values arrive, unless the form takes every new value", () => {
	assert.deepEqual(resetOptionsOf(true), { keepDirtyValues: true });
	// a save that was tried stays tried, so messages follow each change after the refetch of the saved values
	assert.deepEqual(resetOptionsOf(false), { keepIsSubmitted: true, keepSubmitCount: true });
});
