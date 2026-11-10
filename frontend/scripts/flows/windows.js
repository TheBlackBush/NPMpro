// The proxy host window with a custom location, an access list and a certificate (and the lists that must follow), a
// save that nginx refuses and its re-save, and the unsaved-changes question of all four host windows.
import { TYPES, unsavedChanges, viewOnly } from "./hosts.js";
import {
	addDomain,
	cleanUp,
	openFromMenu,
	openTab,
	rowAction,
	rowShows,
	saveWindow,
	uploadCertificate,
	windowClosed,
	windowTitled,
	withToast,
} from "./lib.js";

const CUSTOM_OPTION = /^Custom/u;
const FLOW_LIST_OPTION = /flow-acl/u;
const FLOW_CERTIFICATE_OPTION = /flow-cert/u;

async function proxyLocationAccess(env) {
	const { page, api } = env.admin;
	try {
		const list = await api("POST", "/nginx/access-lists", {
			name: "flow-acl",
			satisfy_any: true,
			items: [{ username: "flow", password: "flow-password-1" }],
			clients: [{ address: "10.0.0.0/8", directive: "allow" }],
		});
		await uploadCertificate(api, "flow-cert");
		// the lists a host save must change are opened first, so their cached rows are the old ones
		await page.goto("/certificates");
		await rowShows(page, "flow-cert", "Not Used");
		await openFromMenu(page, "/access");
		await rowShows(page, "flow-acl", "0 Proxy Hosts");
		await openFromMenu(page, "/nginx/proxy");

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
		await openTab(dialog, "tls");
		await dialog.locator("#certificateId").click();
		await page.getByRole("option", { name: FLOW_CERTIFICATE_OPTION }).click();
		await saveWindow(page, "Proxy Host");
		await rowShows(page, "flow-location.example.com", "flow-acl");
		await rowShows(page, "flow-location.example.com", "Online");

		const host = (await api("GET", "/nginx/proxy-hosts")).find((row) =>
			row.domain_names.includes("flow-location.example.com"),
		);
		if (host.locations?.[0]?.path !== "/flow") throw new Error("the location was not stored");
		if (!host.access_lists?.some((row) => row.id === list.id)) throw new Error("the access list was not stored");
		if (!host.certificate_id) throw new Error("the certificate was not stored");

		// a host with a certificate: the TLS tab controls are open to the rules, so only the View window locks them
		await viewOnly(
			{
				...TYPES.find((type) => type.name === "proxy hosts"),
				label: "flow-location.example.com",
				noAdvanced: true,
			},
			env,
		);

		// the other lists follow the save without a reload
		await openFromMenu(page, "/access");
		await rowShows(page, "flow-acl", "1 Proxy Host");
		await openFromMenu(page, "/certificates");
		await rowShows(page, "flow-cert", "In Use");
		await openFromMenu(page, "/nginx/proxy");

		await rowAction(page, "flow-location.example.com", "Edit");
		await windowTitled(page, "Edit Proxy Host");
		await openTab(dialog, "locations");
		if ((await dialog.locator('input[name="locations.0.path"]').inputValue()) !== "/flow") {
			throw new Error("the Edit window does not show the location");
		}
		await page.keyboard.press("Escape");
		await windowClosed(page);

		// and a delete frees them again
		await rowAction(page, "flow-location.example.com", "Delete");
		await withToast(page, "Proxy Host has been deleted", () =>
			page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click(),
		);
		await openFromMenu(page, "/access");
		await rowShows(page, "flow-acl", "0 Proxy Hosts");
		await openFromMenu(page, "/certificates");
		await rowShows(page, "flow-cert", "Not Used");
	} finally {
		await cleanUp(api);
	}
}

async function nginxErrorResave({ admin }) {
	const { page, api } = admin;
	try {
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
	} finally {
		await cleanUp(api);
	}
}

async function unsavedChangesOfAllWindows(env) {
	for (const type of TYPES) {
		// biome-ignore lint/performance/noAwaitInLoops: one window type after another
		await unsavedChanges(type, env);
	}
}

// The X of a window with a clean form: the pressed button must not take the focus from the field (a blur validates
// it, and its required error would show while the window closes). Checked while the mouse button is down.
async function closeWithoutErrors({ admin }) {
	const { page } = admin;
	await page.goto("/nginx/stream");
	await page.getByRole("button", { name: "Add Stream", exact: true }).first().click();
	await windowTitled(page, "Add Stream");
	const dialog = page.getByRole("dialog");
	await dialog.locator("input[name=incomingPort]").click();
	// records an invalid field that shows before the window is gone
	await dialog.evaluate((element) => {
		window.flowInvalid = false;
		const observer = new MutationObserver(() => {
			if (element.querySelector("[aria-invalid=true]")) window.flowInvalid = true;
		});
		observer.observe(element, { subtree: true, childList: true, attributes: true });
	});
	const box = await dialog.getByRole("button", { name: "Close", exact: true }).boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	const focused = await page.evaluate(() => document.activeElement?.getAttribute("name"));
	await page.mouse.up();
	await windowClosed(page);
	if (focused !== "incomingPort") throw new Error(`pressing the X moved the focus from the field (to ${focused})`);
	if (await page.evaluate(() => window.flowInvalid))
		throw new Error("a required error showed while the window closed");
}

export const windowFlows = [
	{ name: "proxy location and access list", run: proxyLocationAccess },
	{ name: "nginx error and re-save", run: nginxErrorResave },
	{ name: "unsaved changes", run: unsavedChangesOfAllWindows },
	{ name: "close without errors", run: closeWithoutErrors },
];
