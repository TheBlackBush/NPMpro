// The proxy host window with a custom location and an access list, a save that nginx refuses and its re-save, and the
// unsaved-changes question for Cancel and for the X.
import { addDomain, openTab, rowAction, rowShows, saveWindow, windowClosed, windowTitled } from "./lib.js";

const CUSTOM_OPTION = /^Custom/u;
const FLOW_LIST_OPTION = /flow-acl/u;

async function proxyLocationAccess({ admin }) {
	const { page, api } = admin;
	const list = await api("POST", "/nginx/access-lists", {
		name: "flow-acl",
		satisfy_any: true,
		items: [{ username: "flow", password: "flow-password-1" }],
		clients: [{ address: "10.0.0.0/8", directive: "allow" }],
	});
	await page.goto("/nginx/proxy");
	await page.getByRole("button", { name: "Add Proxy Host", exact: true }).first().click();
	await windowTitled(page, "Add Proxy Host");
	const dialog = page.getByRole("dialog");
	await addDomain(dialog, "flow-location.example.com");
	await dialog.locator("input[name=forwardHost]").fill("127.0.0.1");
	await dialog.locator("input[name=forwardPort]").fill("8080");
	// the host's access: Custom, then the flow's list in the row Add creates (Add preselects the first unused list)
	await dialog.getByRole("combobox", { name: "Access List" }).first().click();
	await page.getByRole("option", { name: CUSTOM_OPTION }).click();
	await dialog.getByRole("button", { name: "Add", exact: true }).click();
	await dialog.getByRole("combobox", { name: "Access List" }).nth(1).click();
	await page.getByRole("option", { name: FLOW_LIST_OPTION }).click();
	await openTab(dialog, "locations");
	await dialog.getByRole("button", { name: "Add Location", exact: true }).click();
	await dialog.locator('input[name="locations.0.path"]').fill("/flow");
	await dialog.locator('input[name="locations.0.forwardHost"]').fill("127.0.0.1");
	await dialog.locator('input[name="locations.0.forwardPort"]').fill("8081");
	await saveWindow(page, "Proxy Host");
	await rowShows(page, "flow-location.example.com", "flow-acl");
	await rowShows(page, "flow-location.example.com", "Online");

	const host = (await api("GET", "/nginx/proxy-hosts")).find((row) =>
		row.domain_names.includes("flow-location.example.com"),
	);
	if (host.locations?.[0]?.path !== "/flow") throw new Error("the location was not stored");
	if (!host.access_lists?.some((row) => row.id === list.id)) throw new Error("the access list was not stored");

	await rowAction(page, "flow-location.example.com", "Edit");
	await windowTitled(page, "Edit Proxy Host");
	await openTab(dialog, "locations");
	if ((await dialog.locator('input[name="locations.0.path"]').inputValue()) !== "/flow") {
		throw new Error("the Edit window does not show the location");
	}
	await page.keyboard.press("Escape");
	await windowClosed(page);
}

async function nginxErrorResave({ admin }) {
	const { page, api } = admin;
	await page.goto("/nginx/proxy");
	await page.getByRole("button", { name: "Add Proxy Host", exact: true }).first().click();
	await windowTitled(page, "Add Proxy Host");
	const dialog = page.getByRole("dialog");
	await addDomain(dialog, "flow-broken.example.com");
	await dialog.locator("input[name=forwardHost]").fill("127.0.0.1");
	await dialog.locator("input[name=forwardPort]").fill("8080");
	await openTab(dialog, "advanced");
	await dialog.locator("#advancedConfig").fill("this_is_not_a_directive;");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	// saved, but nginx refused the config: the window stays open with the message, now as the host's Edit window
	await dialog.getByText("was saved, but nginx rejected its config").waitFor();
	await windowTitled(page, "Edit Proxy Host");
	await rowShows(page, "flow-broken.example.com", "Config error");
	// the second save updates the same host
	await dialog.locator("#advancedConfig").fill("");
	await saveWindow(page, "Proxy Host");
	await rowShows(page, "flow-broken.example.com", "Online");
	const saved = (await api("GET", "/nginx/proxy-hosts")).filter((row) =>
		row.domain_names.includes("flow-broken.example.com"),
	);
	if (saved.length !== 1) throw new Error(`${saved.length} hosts saved, expected one`);
}

async function unsavedChanges({ admin }) {
	const { page, api } = admin;
	await page.goto("/nginx/404");
	await page.getByRole("button", { name: "Add 404 Host", exact: true }).first().click();
	await windowTitled(page, "Add 404 Host");
	const dialog = page.getByRole("dialog");
	await addDomain(dialog, "flow-unsaved.example.com");
	const ask = page.getByRole("alertdialog");

	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await ask.getByRole("heading", { name: "Unsaved changes" }).waitFor();
	await ask.getByRole("button", { name: "Keep editing", exact: true }).click();
	await ask.waitFor({ state: "detached" });
	await dialog.locator("[data-slot=combobox-chips]").getByText("flow-unsaved.example.com", { exact: true }).waitFor();

	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await ask.getByRole("heading", { name: "Unsaved changes" }).waitFor();
	await ask.getByRole("button", { name: "Discard changes", exact: true }).click();
	await windowClosed(page);
	const kept = (await api("GET", "/nginx/dead-hosts")).filter((row) =>
		row.domain_names.includes("flow-unsaved.example.com"),
	);
	if (kept.length > 0) throw new Error("the discarded host was saved");
}

export const windowFlows = [
	{ name: "proxy location and access list", run: proxyLocationAccess },
	{ name: "nginx error and re-save", run: nginxErrorResave },
	{ name: "unsaved changes", run: unsavedChanges },
];
