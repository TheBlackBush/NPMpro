import assert from "node:assert/strict";
import { it } from "node:test";
import { hasErrorIn, LINE_LAYOUTS, openOnRefusedSave, settingLineClass, settingsCardClass } from "./SettingLayout.js";

const has = (classes, ...names) => {
	const list = classes.split(" ");
	for (const name of names) assert.ok(list.includes(name), `"${classes}" lacks ${name}`);
};
const lacks = (classes, ...names) => {
	const list = classes.split(" ");
	for (const name of names) assert.ok(!list.includes(name), `"${classes}" has ${name}`);
};

it("lists the four layouts of a setting line", () => {
	assert.deepEqual([...LINE_LAYOUTS], ["inline", "block", "switch", "value"]);
	assert.ok(Object.isFrozen(LINE_LAYOUTS));
});

it("draws an inline line as the landing page lines: a row from the lg container width, a 14rem control", () => {
	const line = settingLineClass("inline");
	assert.equal(line.container, "@container");
	has(line.row, "group/row", "@lg:flex-row", "@lg:items-center");
	assert.equal(line.text, "min-w-0 flex-1 @lg:group-has-[[data-slot=field-error]]/row:pt-1.5");
	assert.equal(line.titleRow, "flex flex-wrap items-center gap-x-2 gap-y-1");
	assert.equal(line.title, "text-sm font-semibold");
	assert.equal(line.hint, "mt-0.5 text-[0.8rem] text-muted-foreground");
	assert.equal(line.wrap, "flex items-center gap-2 @lg:shrink-0");
	assert.equal(line.control, "min-w-0 flex-1 @lg:w-56 @lg:flex-none");
	assert.deepEqual(settingLineClass(), line);
});

it("aligns an inline or value line to the top while its control shows an error", () => {
	const top = "@lg:has-[[data-slot=field-error]]:items-start";
	has(settingLineClass("inline").row, top);
	has(settingLineClass("value").row, top);
	lacks(settingLineClass("block").row, top);
});

it("puts a block line's field under its name at full width at every width", () => {
	const line = settingLineClass("block");
	has(line.row, "flex", "flex-col", "px-4", "py-3");
	lacks(line.row, "@lg:flex-row");
	has(line.control, "min-w-0", "flex-1");
	lacks(line.control, "@lg:w-56");
});

it("keeps a switch on the right at every width and fades a disabled switch line", () => {
	const line = settingLineClass("switch");
	has(line.row, "flex", "items-start", "justify-between", "has-[:disabled]:opacity-50");
	lacks(line.row, "flex-col");
	has(line.control, "shrink-0");
});

it("shows a read-only value on the right from the lg width and lets it wrap", () => {
	const line = settingLineClass("value");
	has(line.row, "flex-col", "@lg:flex-row");
	has(line.control, "min-w-0", "break-words", "@lg:text-right");
	has(line.wrap, "@lg:max-w-1/2");
});

it("uses one title and one hint class in every layout", () => {
	for (const layout of LINE_LAYOUTS) {
		assert.equal(settingLineClass(layout).title, "text-sm font-semibold");
		assert.equal(settingLineClass(layout).hint, "mt-0.5 text-[0.8rem] text-muted-foreground");
	}
});

it("refuses an unknown layout", () => {
	assert.throws(() => settingLineClass("wide"), TypeError);
});

it("draws a card with a divider under the title bar and a padded body", () => {
	const card = settingsCardClass();
	assert.equal(card.card, "rounded-lg border bg-card text-card-foreground");
	has(card.header, "relative", "flex", "px-4", "py-3", "border-b");
	assert.equal(card.body, "space-y-4 p-4");
});

it("draws a lines card edge to edge with hairlines between the lines", () => {
	const card = settingsCardClass({ lines: true });
	has(card.card, "overflow-hidden");
	assert.equal(card.body, "divide-y");
});

it("draws a closed collapsible card without the divider and with a hover on its title bar", () => {
	const closed = settingsCardClass({ collapsible: true, open: false });
	has(closed.card, "overflow-hidden");
	lacks(closed.header, "border-b");
	has(closed.header, "hover:bg-muted/50");
	has(closed.trigger, "after:absolute", "after:inset-0", "focus-visible:after:ring-3");
	has(settingsCardClass({ collapsible: true, open: true }).header, "border-b");
});

it("finds an error of one of the names, also nested and in lists", () => {
	const errors = {
		requestTimeout: { type: "manual", message: "Too small" },
		autoCreatePermissions: { hosts: { type: "manual", message: "Bad" } },
		items: [undefined, { path: { type: "manual", message: "Bad" } }],
	};
	assert.equal(hasErrorIn(errors, ["requestTimeout"]), true);
	assert.equal(hasErrorIn(errors, ["autoCreatePermissions"]), true);
	assert.equal(hasErrorIn(errors, ["items"]), true);
	assert.equal(hasErrorIn(errors, ["request"]), false);
	assert.equal(hasErrorIn(errors, ["apiUrl", "apiKey"]), false);
	assert.equal(hasErrorIn({}, ["requestTimeout"]), false);
	assert.equal(hasErrorIn(undefined, ["requestTimeout"]), false);
});

it("opens a card on a refused save with an error inside, once per save", () => {
	const errors = { requestTimeout: { type: "manual", message: "Too small" } };
	const closed = { open: false, seenSubmits: 0 };
	assert.equal(openOnRefusedSave(closed, { submitCount: 0, errors, names: ["requestTimeout"] }), closed);
	assert.deepEqual(openOnRefusedSave(closed, { submitCount: 1, errors, names: ["requestTimeout"] }), {
		open: true,
		seenSubmits: 1,
	});
	assert.deepEqual(openOnRefusedSave(closed, { submitCount: 1, errors: {}, names: ["requestTimeout"] }), {
		open: false,
		seenSubmits: 1,
	});
	// closed again by the user after the save: it stays closed until the next save
	const reclosed = { open: false, seenSubmits: 1 };
	assert.equal(openOnRefusedSave(reclosed, { submitCount: 1, errors, names: ["requestTimeout"] }), reclosed);
	// an open card is never closed by a save
	assert.deepEqual(openOnRefusedSave({ open: true, seenSubmits: 1 }, { submitCount: 2, errors: {}, names: [] }), {
		open: true,
		seenSubmits: 2,
	});
});
