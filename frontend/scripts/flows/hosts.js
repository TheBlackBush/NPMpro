// The four host lists: create, edit, view as a limited user, disable, enable, delete. Each step waits for the row to
// show the change: the list refreshes without a reload.
import {
	addDomain,
	openTab,
	rowAction,
	rowGone,
	rowShows,
	saveWindow,
	signIn,
	VIEWER_EMAIL,
	windowClosed,
	windowTitled,
	withToast,
} from "./lib.js";

const TYPES = [
	{
		name: "404 hosts",
		route: "/nginx/404",
		object: "404 Host",
		path: "dead-hosts",
		focus: "dead-host",
		label: "flow-dead.example.com",
		matches: (row) => row.domain_names.includes("flow-dead.example.com"),
		fill: (dialog) => addDomain(dialog, "flow-dead.example.com"),
		edit: (dialog) => addDomain(dialog, "flow-dead2.example.com"),
		edited: "flow-dead2.example.com",
		firstField: "#domainNames",
		advanced: "#advancedConfig",
	},
	{
		name: "redirection hosts",
		route: "/nginx/redirection",
		object: "Redirection Host",
		path: "redirection-hosts",
		focus: "redirection-host",
		label: "flow-redirect.example.com",
		matches: (row) => row.domain_names.includes("flow-redirect.example.com"),
		fill: async (dialog) => {
			await addDomain(dialog, "flow-redirect.example.com");
			await dialog.locator("input[name=forwardDomainName]").fill("target.example.org");
		},
		edit: (dialog) => dialog.locator("input[name=forwardDomainName]").fill("target2.example.org"),
		edited: "target2.example.org",
		firstField: "#domainNames",
		advanced: "#advancedConfig",
	},
	{
		name: "proxy hosts",
		route: "/nginx/proxy",
		object: "Proxy Host",
		path: "proxy-hosts",
		focus: "proxy-host",
		label: "flow-proxy.example.com",
		matches: (row) => row.domain_names.includes("flow-proxy.example.com"),
		fill: async (dialog) => {
			await addDomain(dialog, "flow-proxy.example.com");
			await dialog.locator("input[name=forwardHost]").fill("127.0.0.1");
			await dialog.locator("input[name=forwardPort]").fill("8080");
		},
		edit: (dialog) => dialog.locator("input[name=forwardPort]").fill("8081"),
		edited: ":8081",
		firstField: "#domainNames",
		advanced: "#advancedConfig",
	},
	{
		name: "streams",
		route: "/nginx/stream",
		object: "Stream",
		path: "streams",
		focus: "stream",
		label: "19601",
		matches: (row) => String(row.incoming_port) === "19601",
		fill: async (dialog) => {
			await dialog.locator("input[name=incomingPort]").fill("19601");
			await dialog.locator("input[name=forwardingHost]").fill("127.0.0.1");
			await dialog.locator("input[name=forwardingPort]").fill("8080");
			await dialog.locator("input[name=npmproDescription]").fill("flow-stream");
		},
		edit: (dialog) => dialog.locator("input[name=npmproDescription]").fill("flow-stream edited"),
		edited: "flow-stream edited",
		firstField: "input[name=incomingPort]",
		advanced: "#npmproAdvancedConfig",
	},
];

// the limited user sees one menu item, View, and a window where nothing can be changed or saved
async function viewOnly(type, { browser, base, viewerPassword }) {
	const viewer = await signIn(browser, base, VIEWER_EMAIL, viewerPassword);
	try {
		const { page } = viewer;
		await page.goto(type.route);
		await page
			.getByRole("button", { name: `Actions for ${type.label}`, exact: true })
			.filter({ visible: true })
			.click();
		const items = page.getByRole("menuitem");
		await items.first().waitFor();
		if ((await items.count()) !== 1) throw new Error(`the viewer's menu has ${await items.count()} items`);
		await page.getByRole("menuitem", { name: "View", exact: true }).click();
		await windowTitled(page, `View ${type.object}`);
		const dialog = page.getByRole("dialog");
		if (!(await dialog.locator(type.firstField).isDisabled()))
			throw new Error("a field of the View window is enabled");
		if ((await dialog.getByRole("button", { name: "Save" }).count()) !== 0)
			throw new Error("the View window can save");
		await openTab(dialog, "tls");
		await dialog.locator("[role=tabpanel] fieldset[disabled]").first().waitFor({ state: "attached" });
		await openTab(dialog, "advanced");
		if ((await dialog.locator(type.advanced).getAttribute("readonly")) === null) {
			throw new Error("the advanced config can be edited in the View window");
		}
		await page.keyboard.press("Escape");
		await windowClosed(page);
		if (viewer.errors.length > 0) throw new Error(`page error for the viewer: ${viewer.errors[0]}`);
	} finally {
		await viewer.context.close();
	}
}

async function hostFlow(type, env) {
	const { page, api } = env.admin;
	await page.goto(type.route);
	const dialog = page.getByRole("dialog");

	await page
		.getByRole("button", { name: `Add ${type.object}`, exact: true })
		.first()
		.click();
	await windowTitled(page, `Add ${type.object}`);
	await type.fill(dialog);
	await saveWindow(page, type.object);
	await rowShows(page, type.label, "Online");
	const { id } = (await api("GET", `/nginx/${type.path}`)).find(type.matches);

	// the edit also sets an advanced config, which the viewer must see read-only
	await rowAction(page, type.label, "Edit");
	await windowTitled(page, `Edit ${type.object}`);
	await type.edit(dialog);
	await openTab(dialog, "advanced");
	await dialog.locator(type.advanced).fill("# flow");
	await saveWindow(page, type.object);
	await rowShows(page, type.label, type.edited);

	// an unchanged window closed with Escape gives the focus back to the row's action button
	await rowAction(page, type.label, "Edit");
	await windowTitled(page, `Edit ${type.object}`);
	await page.keyboard.press("Escape");
	await windowClosed(page);
	await page.waitForFunction(
		(key) => document.activeElement?.getAttribute("data-row-actions") === key,
		`${type.focus}-${id}`,
	);

	await viewOnly(type, env);

	await withToast(page, `${type.object} has been disabled`, () => rowAction(page, type.label, "Disable"));
	await rowShows(page, type.label, "Disabled");
	await withToast(page, `${type.object} has been enabled`, () => rowAction(page, type.label, "Enable"));
	await rowShows(page, type.label, "Online");

	await rowAction(page, type.label, "Delete");
	const confirm = page.getByRole("alertdialog");
	await withToast(page, `${type.object} has been deleted`, () =>
		confirm.getByRole("button", { name: "Delete", exact: true }).click(),
	);
	await rowGone(page, type.label);
}

export const hostFlows = TYPES.map((type) => ({ name: type.name, run: (env) => hostFlow(type, env) }));
