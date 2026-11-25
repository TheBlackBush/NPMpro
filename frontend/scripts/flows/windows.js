// The Pages tab and the denied page of the access list, the proxy host window with a custom location, an access list,
// a certificate and the ACME override note (and the lists that must follow), a save that nginx refuses and its
// re-save, and the unsaved-changes question of all four host windows.
import { TYPES, unsavedChanges, viewOnly } from "./hosts.js";
import {
	addDomain,
	cleanUp,
	openFromMenu,
	openTab,
	revealRow,
	rowAction,
	rowOf,
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
const NEW_CERTIFICATE_OPTION = /Request a new Certificate/u;
const ACME_NOTE = "takes /.well-known/acme-challenge/ over";

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
		// a new location follows the host's Auth Request (the host's select is on the other tab, so it is not visible)
		const locationAuth = dialog
			.getByRole("combobox", { name: "Auth Request", exact: true })
			.filter({ visible: true });
		if (!(await locationAuth.first().textContent()).includes("Same as host")) {
			throw new Error("a new location does not show Same as host");
		}
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
		if (host.locations?.[0]?.npmpro_auth_request !== "global") {
			throw new Error("the location did not store Same as host");
		}

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
		// a location set to none on a host with forward authentication shows the notice; Same as host does not
		const notice = dialog.getByText("this location is set to none");
		if (await notice.count()) throw new Error("the notice shows for a Same as host location");
		await openTab(dialog, "details");
		await dialog.getByRole("combobox", { name: "Auth Request", exact: true }).filter({ visible: true }).click();
		await page.getByRole("option", { name: "anubis", exact: true }).click();
		await openTab(dialog, "locations");
		await dialog.locator("button[aria-controls^=location-body-]").click();
		await dialog.getByRole("combobox", { name: "Auth Request", exact: true }).filter({ visible: true }).click();
		await page.getByRole("option", { name: "none", exact: true }).click();
		await notice.waitFor();
		// a location on the ACME challenge path: no note for the uploaded certificate, the note for a Let's Encrypt
		// certificate with the HTTP challenge, gone again with the DNS challenge (nothing is saved)
		const acmeNote = dialog.getByText(ACME_NOTE);
		await dialog.getByRole("button", { name: "Add Location", exact: true }).click();
		await dialog.locator('input[name="locations.1.path"]').fill("/.well-known/acme-challenge/");
		await dialog.locator('input[name="locations.1.forwardHost"]').fill("127.0.0.1");
		await dialog.locator('input[name="locations.1.forwardPort"]').fill("8082");
		if (await acmeNote.count()) throw new Error("the ACME note shows for an uploaded certificate");
		await openTab(dialog, "tls");
		await dialog.locator("#certificateId").click();
		await page.getByRole("option", { name: NEW_CERTIFICATE_OPTION }).click();
		await openTab(dialog, "locations");
		if (!(await acmeNote.count())) await dialog.locator("button[aria-controls^=location-body-]").nth(1).click();
		await acmeNote.waitFor();
		await openTab(dialog, "tls");
		await dialog.locator("#npmproDnsChallenge").click();
		await openTab(dialog, "locations");
		await acmeNote.waitFor({ state: "detached" });
		// the window was changed: closing it asks, and discarding stores nothing
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		await page.getByRole("alertdialog").getByRole("button", { name: "Discard changes", exact: true }).click();
		await windowClosed(page);
		const stored = (await api("GET", "/nginx/proxy-hosts")).find((row) =>
			row.domain_names.includes("flow-location.example.com"),
		);
		if (stored.locations?.length !== 1) throw new Error("the discarded window stored a location");

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

const UPSTREAM_PAGE = "<p>flow upstream down</p>";

// The proxy host's Pages tab: maintenance on and a custom upstream error page by upload; the stored host has both,
// and the reopened window shows the saved page in its paste box (the single-row load path)
async function proxyHostPages({ admin }) {
	const { page, api } = admin;
	try {
		const host = await api("POST", "/nginx/proxy-hosts", {
			domain_names: ["flow-pages.example.com"],
			forward_scheme: "http",
			forward_host: "127.0.0.1",
			forward_port: 8080,
		});
		await page.goto("/nginx/proxy");
		await rowAction(page, "flow-pages.example.com", "Edit");
		await windowTitled(page, "Edit Proxy Host");
		const dialog = page.getByRole("dialog");
		await openTab(dialog, "pages");
		await dialog.locator("#npmproMaintenance").click();
		await dialog.locator("#npmproPageUpstream").click();
		await page.getByRole("option", { name: "Custom page", exact: true }).click();
		await dialog.locator("[data-page-upload=npmproPageUpstreamHtml]").setInputFiles({
			name: "down.html",
			mimeType: "text/html",
			buffer: Buffer.from(UPSTREAM_PAGE),
		});
		if ((await dialog.locator("#npmproPageUpstream-html").inputValue()) !== UPSTREAM_PAGE) {
			throw new Error("the uploaded file did not fill the field");
		}
		await saveWindow(page, "Proxy Host");
		const stored = await api("GET", `/nginx/proxy-hosts/${host.id}`);
		if (!(stored.npmpro_maintenance && stored.npmpro_page_upstream === "custom")) {
			throw new Error(`the pages were not stored: ${stored.npmpro_maintenance} ${stored.npmpro_page_upstream}`);
		}
		if (stored.npmpro_page_upstream_html !== UPSTREAM_PAGE) throw new Error("the page was not stored");

		// reopened: the saved page is in the paste box
		await rowAction(page, "flow-pages.example.com", "Edit");
		await windowTitled(page, "Edit Proxy Host");
		await openTab(dialog, "pages");
		await dialog.locator("#npmproPageUpstream-html").waitFor();
		if ((await dialog.locator("#npmproPageUpstream-html").inputValue()) !== UPSTREAM_PAGE) {
			throw new Error("the reopened window does not show the saved page");
		}
		// Preview follows the saved choice: the site's own 404 (the default) has no page of NPMpro to preview
		const preview = (type) => dialog.locator(`a[href$="/preview/proxy-host/${host.id}/${type}"]`).count();
		if ((await preview("upstream_error")) !== 1 || (await preview("not_found")) !== 0) {
			throw new Error("Preview does not follow the saved choices of the Pages tab");
		}
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		await windowClosed(page);
	} finally {
		await cleanUp(api);
	}
}

// The access list's Denied page: nginx's plain page is stored, and the list answer holds no page HTML
async function accessListDeniedPage({ admin }) {
	const { page, api } = admin;
	try {
		await page.goto("/access");
		await page.getByRole("button", { name: "Add Access List", exact: true }).first().click();
		await windowTitled(page, "Add Access List");
		const dialog = page.getByRole("dialog");
		await dialog.locator("input[name=name]").fill("flow-denied");
		await dialog.locator("#npmproDeniedPage").click();
		await page.getByRole("option", { name: "nginx's plain page", exact: true }).click();
		await openTab(dialog, "rules");
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
		await dialog.locator('input[name="clients.0.address"]').fill("10.0.0.0/8");
		await saveWindow(page, "Access List");
		const list = (await api("GET", "/nginx/access-lists")).find((row) => row.name === "flow-denied");
		if (list?.npmpro_denied_page !== "plain") throw new Error(`the denied page is ${list?.npmpro_denied_page}`);
		if (Object.hasOwn(list, "npmpro_denied_page_html")) throw new Error("the list answer holds the page HTML");
	} finally {
		await cleanUp(api);
	}
}

const FLOW_CA = "https://acme-v02.api.letsencrypt.org/directory";
const CA_FIELD = /^Certificate authority/u;
const ACME_SERVERS_URL = /\/api\/nginx\/certificates\/acme-servers/u;
const CERTIFICATE_LIST_URL = /\/api\/nginx\/certificates(?:\?|$)/u;

const TRAILING_SLASHES = /\/+$/u;
// a CA URL compared in any case of its scheme and host and without a trailing slash (enough for the flow's lists)
const caKey = (server) => server.toLowerCase().replace(TRAILING_SLASHES, "");

// The CA of a certificate: the list has the CA column with the certificate's CA. With the one CA of a fresh instance
// the create windows show no CA select and Re-issue says there is no other CA; with several CAs (an instance where an
// administrator added some) the create windows show the select and Re-issue offers the other CAs, nothing chosen.
// Cancel closes each window. The list answer is rewritten so the uploaded certificate looks like a Let's Encrypt one.
async function certificateAuthority({ admin }) {
	const { page, api } = admin;
	try {
		await uploadCertificate(api, "flow-ca");
		await page.route(CERTIFICATE_LIST_URL, async (route) => {
			const answer = await route.fetch();
			const rows = await answer.json();
			await route.fulfill({
				response: answer,
				json: rows.map((row) =>
					row.nice_name === "flow-ca"
						? { ...row, provider: "letsencrypt", npmpro_acme_server: FLOW_CA, npmpro_dns_challenge: false }
						: row,
				),
			});
		});
		// the list itself reads the CAs (for the CAA badge), so the answer is waited for from before the page opens
		const serversLoaded = page.waitForResponse(ACME_SERVERS_URL);
		await page.goto("/certificates");
		await page.getByRole("columnheader", { name: "CA", exact: true }).waitFor();
		// the cell under the CA header, not the Provider column that also says Let's Encrypt
		const headers = await page.locator("thead th").allInnerTexts();
		const column = headers.findIndex((text) => text.trim() === "CA");
		// the row shows the certificate's domain (the uploaded CN), the nice name only names its actions
		await revealRow(page, "flow.example.com");
		const cell = await rowOf(page, "flow.example.com").locator("td").nth(column).textContent();
		if (cell.trim() !== "Let's Encrypt") throw new Error(`the CA cell shows "${cell}"`);
		let servers;
		for (const menuItem of ["Certbot via HTTP", "Certbot via DNS"]) {
			// biome-ignore lint/performance/noAwaitInLoops: one window after the other
			await page.getByRole("button", { name: "Add Certificate", exact: true }).first().click();
			await page.getByRole("menuitem", { name: menuItem, exact: true }).click();
			await page.getByRole("dialog").waitFor();
			// the list of CAs has answered (cached for the second window) before the select is looked for
			servers ??= await (await serversLoaded).json();
			const field = page.getByRole("dialog").getByText(CA_FIELD);
			if (servers.length > 1) {
				await field.waitFor();
			} else {
				await page.evaluate(
					() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
				);
				if ((await field.count()) > 0) throw new Error(`${menuItem}: the CA select shows with one CA`);
			}
			await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
			await windowClosed(page);
		}
		const others = servers.filter((entry) => caKey(entry.server) !== caKey(FLOW_CA));
		await rowAction(page, "flow-ca", "Re-issue");
		await windowTitled(page, "Re-issue Certificate");
		const reissue = page.getByRole("dialog");
		if (others.length > 0) {
			await reissue.getByText(CA_FIELD).waitFor();
			await reissue.getByRole("combobox").click();
			const options = await page.getByRole("option").count();
			if (options !== others.length) throw new Error(`Re-issue offers ${options} CAs, not ${others.length}`);
			await page.keyboard.press("Escape");
		} else {
			await reissue.getByText("There is no other certificate authority").waitFor();
		}
		// nothing is chosen yet, so there is nothing to re-issue at
		if (!(await reissue.getByRole("button", { name: "Re-issue", exact: true }).isDisabled()))
			throw new Error("Re-issue is enabled with no CA chosen");
		await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
		await windowClosed(page);
	} finally {
		await page.unroute(CERTIFICATE_LIST_URL);
		await cleanUp(api);
	}
}

// The Edit window of an ACME certificate's domain names. Issuing is not part of the flows, so the list answer is
// rewritten: an uploaded certificate looks like a Let's Encrypt one with a proxy host that uses two of its names.
// Nothing is saved: the window opens with the names and Save disabled, dropping a name the host uses shows the
// uncovered warning, and Cancel then the discard question closes it.
async function editCertificateDomains({ admin }) {
	const { page, api } = admin;
	const names = ["flow-a.example.com", "flow-b.example.com"];
	try {
		await uploadCertificate(api, "flow-edit-domains");
		await page.route(CERTIFICATE_LIST_URL, async (route) => {
			const answer = await route.fetch();
			const rows = await answer.json();
			await route.fulfill({
				response: answer,
				json: rows.map((row) =>
					row.nice_name === "flow-edit-domains"
						? {
								...row,
								provider: "letsencrypt",
								domain_names: names,
								npmpro_acme_server: FLOW_CA,
								npmpro_dns_challenge: false,
								proxy_hosts: [{ id: 999999, domain_names: names }],
							}
						: row,
				),
			});
		});
		await page.goto("/certificates");
		await rowAction(page, "flow-edit-domains", "Edit");
		await windowTitled(page, "Edit Domain Names");
		const dialog = page.locator("[role=dialog][data-edit-domains]");
		await dialog.waitFor();
		const chips = dialog.locator("[data-slot=combobox-chips]");
		for (const domain of names) {
			// biome-ignore lint/performance/noAwaitInLoops: each name is looked for in turn
			await chips.getByText(domain, { exact: true }).waitFor();
		}
		if (!(await dialog.getByRole("button", { name: "Save", exact: true }).isDisabled()))
			throw new Error("Save is enabled with the names unchanged");
		if ((await dialog.locator("[data-uncovered-hosts]").count()) !== 0)
			throw new Error("the warning shows before a change");
		await dialog.getByRole("button", { name: `Remove ${names[1]}`, exact: true }).click();
		await dialog.locator("[data-uncovered-hosts]").waitFor();
		if (await dialog.getByRole("button", { name: "Save", exact: true }).isDisabled())
			throw new Error("Save is disabled with a changed list");
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		await page.getByRole("alertdialog").getByRole("button", { name: "Discard changes", exact: true }).click();
		await windowClosed(page);
	} finally {
		await page.unroute(CERTIFICATE_LIST_URL);
		await cleanUp(api);
	}
}

export const windowFlows = [
	{ name: "proxy location and access list", run: proxyLocationAccess },
	{ name: "proxy host pages", run: proxyHostPages },
	{ name: "access list denied page", run: accessListDeniedPage },
	{ name: "nginx error and re-save", run: nginxErrorResave },
	{ name: "unsaved changes", run: unsavedChangesOfAllWindows },
	{ name: "close without errors", run: closeWithoutErrors },
	{ name: "certificate authority", run: certificateAuthority },
	{ name: "edit certificate domains", run: editCertificateDomains },
];
