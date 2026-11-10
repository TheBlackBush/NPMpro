// The four host lists: create, edit, view as a limited user, disable, enable, delete. Each step waits for the row to
// show the change: the list refreshes without a reload.
import {
	addDomain,
	assertAbsent,
	assertFields,
	assertViewOnly,
	openTab,
	removeFlowData,
	rowAction,
	rowGone,
	rowShows,
	saveWindowSent,
	signIn,
	VIEWER_EMAIL,
	windowClosed,
	windowTitled,
	withToast,
} from "./lib.js";

// The fields only another host type has: a window must never send them, and a stored host never holds them
const PROXY_ONLY = ["forward_host", "forward_port", "locations"];
const REDIRECTION_ONLY = ["forward_domain_name", "preserve_path", "forward_http_code"];
const STREAM_ONLY = [
	"incoming_port",
	"forwarding_host",
	"forwarding_port",
	"tcp_forwarding",
	"udp_forwarding",
	"npmpro_description",
	"npmpro_advanced_config",
];
const HOST_ONLY = ["domain_names", "advanced_config", "ssl_forced"];

export const TYPES = [
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
		created: { domain_names: ["flow-dead.example.com"] },
		changed: { domain_names: ["flow-dead.example.com", "flow-dead2.example.com"], advanced_config: "# flow" },
		foreign: [...PROXY_ONLY, ...REDIRECTION_ONLY, ...STREAM_ONLY],
		kept: (dialog) =>
			dialog.locator("[data-slot=combobox-chips]").getByText("flow-dead.example.com", { exact: true }).waitFor(),
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
		created: { domain_names: ["flow-redirect.example.com"], forward_domain_name: "target.example.org" },
		changed: { forward_domain_name: "target2.example.org", advanced_config: "# flow" },
		foreign: [...PROXY_ONLY, ...STREAM_ONLY],
		kept: (dialog) =>
			dialog
				.locator("[data-slot=combobox-chips]")
				.getByText("flow-redirect.example.com", { exact: true })
				.waitFor(),
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
		created: { domain_names: ["flow-proxy.example.com"], forward_host: "127.0.0.1", forward_port: 8080 },
		changed: { forward_host: "127.0.0.1", forward_port: 8081, advanced_config: "# flow" },
		foreign: [...REDIRECTION_ONLY, ...STREAM_ONLY],
		kept: (dialog) =>
			dialog.locator("[data-slot=combobox-chips]").getByText("flow-proxy.example.com", { exact: true }).waitFor(),
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
		created: {
			incoming_port: 19601,
			forwarding_host: "127.0.0.1",
			forwarding_port: 8080,
			npmpro_description: "flow-stream",
		},
		changed: { forwarding_port: 8080, npmpro_description: "flow-stream edited", npmpro_advanced_config: "# flow" },
		foreign: [...PROXY_ONLY, ...REDIRECTION_ONLY, ...HOST_ONLY],
		kept: (dialog) =>
			dialog.locator("input[name=incomingPort]").evaluate((el) => {
				if (el.value !== "19601") throw new Error("Keep editing lost the port");
			}),
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
		if ((await dialog.getByRole("button", { name: "Save" }).count()) !== 0)
			throw new Error("the View window can save");
		await assertViewOnly(dialog, `${type.object} View window`);
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

const sentTo = (type) => `/nginx/${type.path}`;

// the request of a save and the stored host must hold what the flow set and nothing of another host type
// biome-ignore lint/complexity/useMaxParams: the parts of one check
async function checkSaved(type, api, sent, expected, step) {
	assertAbsent(sent, type.foreign, `${type.object} ${step} request`);
	assertFields(sent, expected, `${type.object} ${step} request`, { loose: true });
	const row = (await api("GET", sentTo(type))).find(type.matches);
	if (!row) throw new Error(`${type.object} ${step}: the host is not stored`);
	assertAbsent(row, type.foreign, `${type.object} ${step}, stored,`);
	assertFields(row, expected, `${type.object} ${step}, stored`, { loose: true });
	return row;
}

async function checkStored(type, api, expected) {
	const row = (await api("GET", sentTo(type))).find(type.matches);
	assertFields(row, expected, `${type.object} after a discarded edit`, { loose: true });
}

async function hostFlow(type, env) {
	try {
		await hostSteps(type, env);
	} finally {
		await removeFlowData(env.admin.api, false);
	}
}

async function hostSteps(type, env) {
	const { page, api } = env.admin;
	await page.goto(type.route);
	const dialog = page.getByRole("dialog");
	const expected = { ...type.created, ...type.changed };

	await page
		.getByRole("button", { name: `Add ${type.object}`, exact: true })
		.first()
		.click();
	await windowTitled(page, `Add ${type.object}`);
	await type.fill(dialog);
	const created = await saveWindowSent(page, type.object, sentTo(type));
	await rowShows(page, type.label, "Online");
	const { id } = await checkSaved(type, api, created, type.created, "create");

	// the edit also sets an advanced config, which the viewer must see read-only
	await rowAction(page, type.label, "Edit");
	await windowTitled(page, `Edit ${type.object}`);
	await type.edit(dialog);
	await openTab(dialog, "advanced");
	await dialog.locator(type.advanced).fill("# flow");
	const changed = await saveWindowSent(page, type.object, `${sentTo(type)}/${id}`);
	await rowShows(page, type.label, type.edited);
	await checkSaved(type, api, changed, expected, "edit");

	// an unchanged window closed with Escape gives the focus back to the row's action button
	await rowAction(page, type.label, "Edit");
	await windowTitled(page, `Edit ${type.object}`);
	await page.keyboard.press("Escape");
	await windowClosed(page);
	await page.waitForFunction(
		(key) => document.activeElement?.getAttribute("data-row-actions") === key,
		`${type.focus}-${id}`,
	);

	// a changed Edit window asks before it closes, and discarding stores nothing
	await rowAction(page, type.label, "Edit");
	await windowTitled(page, `Edit ${type.object}`);
	await openTab(dialog, "advanced");
	await dialog.locator(type.advanced).fill("# flow, not saved");
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Discard changes", exact: true }).click();
	await windowClosed(page);
	await checkStored(type, api, expected);

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

/**
 * The unsaved-changes question of a new window: Cancel, the X and Escape ask when a field changed (Keep editing keeps
 * the window, Discard closes it and saves nothing) and close at once when nothing changed.
 */
export async function unsavedChanges(type, { admin }) {
	const { page, api } = admin;
	await page.goto(type.route);
	const dialog = page.getByRole("dialog");
	const ask = page.getByRole("alertdialog");
	const open = async () => {
		await page
			.getByRole("button", { name: `Add ${type.object}`, exact: true })
			.first()
			.click();
		await windowTitled(page, `Add ${type.object}`);
	};
	const closers = {
		cancel: () => dialog.getByRole("button", { name: "Cancel", exact: true }).click(),
		x: () => dialog.getByRole("button", { name: "Close", exact: true }).click(),
		escape: () => page.keyboard.press("Escape"),
	};

	for (const [closer, close] of Object.entries(closers)) {
		// biome-ignore lint/performance/noAwaitInLoops: one window after another
		await open();
		await close();
		await windowClosed(page);
		if ((await ask.count()) !== 0) throw new Error(`${type.object}: ${closer} asked on an unchanged window`);
	}

	await open();
	await type.fill(dialog);
	for (const close of Object.values(closers)) {
		// biome-ignore lint/performance/noAwaitInLoops: one closer after another
		await close();
		await ask.getByRole("heading", { name: "Unsaved changes" }).waitFor();
		await ask.getByRole("button", { name: "Keep editing", exact: true }).click();
		await ask.waitFor({ state: "detached" });
		await windowTitled(page, `Add ${type.object}`);
		await type.kept(dialog);
	}
	await closers.x();
	await ask.getByRole("heading", { name: "Unsaved changes" }).waitFor();
	await ask.getByRole("button", { name: "Discard changes", exact: true }).click();
	await windowClosed(page);
	if ((await api("GET", sentTo(type))).some(type.matches))
		throw new Error(`${type.object}: the discarded host was saved`);
}

export const hostFlows = TYPES.map((type) => ({ name: type.name, run: (env) => hostFlow(type, env) }));
