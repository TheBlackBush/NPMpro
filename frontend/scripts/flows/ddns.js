// Dynamic DNS: the tab (status card, Add record, Check now, Update now, History, Disable, Delete) and Settings, Dynamic
// DNS. The updater never calls a provider or an address service: the flow runs only where the IPv4 services are the
// env value DDNS_IPV4_SERVICES (the smoke container sets https://127.0.0.1/ and https://127.0.0.2/, which the guard refuses). The flows
// create their data as flow-... and remove it.
import { cleanUp, rowAction, rowGone, rowShows, windowClosed, windowTitled, withToast } from "./lib.js";

const NAME = "flow-ddns";
const NAME_GANDI = "flow-ddns-gandi";
const ZONE = "flow-ddns.example";
const ZONE_GANDI = "flow-gandi.example";
const RECORD = `home.${ZONE}`;
const ALIAS = `alias.${ZONE_GANDI}`;

// the message of a service address the server may not call
const BLOCKED_TEXT = /may not (?:reach|call)/u;

const recordWindow = (page) => page.locator("[data-ddns-record-window]");
const status = (page) => page.locator("[data-ddns-status]");
const credentialBody = (name, provider, ini, domain) => ({ name, provider, ini, domains: [domain] });

// the updater may call out only to the refused address of the smoke container
const requireLockedServices = async (api) => {
	const settings = await api("GET", "/settings/runtime/ddns");
	const locked = JSON.stringify(settings.locked ?? []);
	if (!(locked.includes("ipv4_services") || locked.includes("ipv4Services")))
		throw new Error(`DDNS_IPV4_SERVICES must be set for this flow (locked: ${locked})`);
	if (!JSON.stringify(settings.values ?? settings).includes("127.0.0.1"))
		throw new Error("DDNS_IPV4_SERVICES is not the refused address https://127.0.0.1/");
};

// the question of the window: asked only when the user changed something; answers by discarding
const closeAsking = async (page, expectQuestion) => {
	const ask = page.getByRole("alertdialog");
	await recordWindow(page).getByRole("button", { name: "Cancel", exact: true }).click();
	if (expectQuestion) {
		await ask.getByRole("heading", { name: "Unsaved changes" }).waitFor({ timeout: 5000 });
		await ask.getByRole("button", { name: "Discard changes", exact: true }).click();
	}
	await recordWindow(page).waitFor({ state: "detached" });
	if ((await ask.count()) !== 0)
		throw new Error(`an unsaved-changes question stayed open (expected ${expectQuestion})`);
};

// types into a name picker (a button that opens a list with a search box); Enter adds the name, else the list is
// dismissed with the text still typed, which Save must keep
const typeName = async (page, field, text, enter) => {
	const search = page.locator("[cmdk-input]");
	const open = async () => {
		await recordWindow(page).locator(field).click();
		return search.waitFor({ timeout: 2000 }).then(
			() => true,
			() => false,
		);
	};
	// the blur of the field before can add its error line and move this field under the click: click again
	if (!((await open()) || (await open()))) await open();
	await search.fill(text);
	await search.press(enter ? "Enter" : "Escape");
	await search.waitFor({ state: "detached" });
	if (enter) await recordWindow(page).locator(field).getByText(text, { exact: true }).waitFor();
};

const addRecord = async (page) => {
	await page.getByRole("button", { name: "Add record", exact: true }).filter({ visible: true }).first().click();
	await recordWindow(page).waitFor();
	await windowTitled(page, "Add Dynamic DNS record");
};

const chooseCredential = async (page, name) => {
	await recordWindow(page).locator("#dnsCredential").click();
	await page.getByRole("option", { name: new RegExp(`^${name}`, "u") }).click();
};

async function dynamicDns({ admin }) {
	const { page, api, errors } = admin;
	// no real provider is called: a stub answers anything that would reach the provider routes of the API
	await page.route("**/api/nginx/dns-credentials/*/provider-domains", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ supported: true, truncated: false, zones: [] }),
		}),
	);
	try {
		await requireLockedServices(api);
		await api(
			"POST",
			"/nginx/dns-credentials",
			credentialBody(NAME, "cloudflare", "dns_cloudflare_api_token=flow-token", ZONE),
		);
		await api(
			"POST",
			"/nginx/dns-credentials",
			credentialBody(NAME_GANDI, "gandi", "dns_gandi_token=flow-token", ZONE_GANDI),
		);

		// 1. no records: the status card says so
		await page.goto("/certificates/dynamic-dns");
		await status(page).waitFor();
		if ((await status(page).getAttribute("data-ddns-status")) !== "none") throw new Error("the status is not none");
		await status(page).getByText("No records", { exact: true }).waitFor();

		// 2. the window: untouched it closes without a question; the IP version shows the suffix field
		await addRecord(page);
		await closeAsking(page, false);
		await addRecord(page);
		const win = recordWindow(page);
		await typeName(page, "#ddnsName", RECORD, true);
		await win.locator("#dnsCredential").getByText(NAME, { exact: false }).waitFor();
		await win.locator("#ddnsZone").waitFor();
		if ((await win.locator("#ddnsZone").inputValue()) !== ZONE)
			throw new Error("the zone is not the credential's domain");
		await win.getByRole("radio", { name: "IPv6", exact: true }).click();
		await win.locator("#ddnsIpv6Suffix").waitFor();
		await win.getByRole("radio", { name: "IPv4", exact: true }).click();
		await win.locator("#ddnsIpv6Suffix").waitFor({ state: "detached" });
		await withToast(page, "saved", () => win.getByRole("button", { name: "Save", exact: true }).click());
		await windowClosed(page);
		await rowShows(page, RECORD, "Pending");

		// 3. Check now: in CI the guard refuses the address service and the record stays Pending
		await status(page).getByRole("button", { name: "Check now", exact: true }).click();
		await page.locator('[data-ddns-status="failed"]').waitFor({ timeout: 30_000 });
		await rowShows(page, RECORD, "Pending");

		// 4. Update now: the toast names the failure; History opens and closes
		await withToast(page, "public address could not be found", () => rowAction(page, RECORD, "Update now"));
		await rowAction(page, RECORD, "History");
		await page.locator("[data-ddns-history-window]").waitFor();
		await page
			.getByRole("dialog")
			.getByRole("heading", { name: `History of ${RECORD}`, exact: true })
			.waitFor();
		await page.keyboard.press("Escape");
		await windowClosed(page);

		// 5. an alias on a provider without wildcards: typed names are kept on Save (no Enter), a wildcard is refused
		await addRecord(page);
		await chooseCredential(page, NAME_GANDI);
		await win.getByRole("radio", { name: "Alias (CNAME)", exact: true }).click();
		await typeName(page, "#ddnsTarget", RECORD, false);
		await typeName(page, "#ddnsName", `*.${ALIAS}`, false);
		await win.getByRole("button", { name: "Save", exact: true }).click();
		await win.getByText("does not allow wildcard records").first().waitFor();
		if (!(await win.isVisible())) throw new Error("the window closed on a refused wildcard");
		await typeName(page, "#ddnsName", ALIAS, true);
		await withToast(page, "saved", () => win.getByRole("button", { name: "Save", exact: true }).click());
		await windowClosed(page);
		await rowShows(page, ALIAS, "Pending");
		const stored = (await api("GET", "/nginx/ddns-records")).find((row) => row.name === ALIAS);
		if (stored?.kind !== "alias" || stored.target !== RECORD)
			throw new Error(`the alias is stored as ${JSON.stringify(stored)}`);

		// 6. the unsaved-changes question: none for a window opened and closed, one for typed text
		await rowAction(page, ALIAS, "Edit");
		await recordWindow(page).waitFor();
		await windowTitled(page, "Edit Dynamic DNS record");
		await closeAsking(page, false);
		await rowAction(page, ALIAS, "Edit");
		await recordWindow(page).waitFor();
		await typeName(page, "#ddnsTarget", `typed.${ZONE}`, false);
		await closeAsking(page, true);
		if ((await api("GET", "/nginx/ddns-records")).find((row) => row.name === ALIAS).target !== RECORD)
			throw new Error("the discarded target was stored");

		// 7. Disable, then Delete (the question names the record)
		await rowAction(page, ALIAS, "Disable");
		await rowShows(page, ALIAS, "Disabled");
		await rowAction(page, ALIAS, "Delete");
		const ask = page.getByRole("alertdialog");
		await ask.getByText(ALIAS, { exact: false }).first().waitFor();
		await ask.getByRole("button", { name: "Delete", exact: true }).click();
		await rowGone(page, ALIAS);
		if (errors.length > 0) throw new Error(`page error: ${errors[0]}`);
	} finally {
		await page.unroute("**/api/nginx/dns-credentials/*/provider-domains").catch(() => undefined);
		await cleanUp(api);
	}
}

async function dynamicDnsSettings({ admin }) {
	const { page, api, errors } = admin;
	const before = await api("GET", "/settings/runtime/ddns");
	try {
		await page.goto("/settings/dynamic-dns");
		await page.locator("#runtime-ipv6Services").waitFor();
		// DDNS_IPV4_SERVICES locks the IPv4 line (CI): its Lock note shows
		const locked = JSON.stringify(before.locked ?? []).includes("ipv4");
		const note = page.getByText("Set by environment", { exact: true });
		if (locked) await note.first().waitFor();
		else console.log("dynamic dns settings: the IPv4 services are not locked here");

		// a service address the server may not call is refused and the message shows under the field
		const input = page.locator("#runtime-ipv6Services");
		await input.fill("https://[::1]/");
		await input.press("Enter");
		await page.locator("form").getByRole("button", { name: "Save", exact: true }).click();
		await page.locator("form").getByText(BLOCKED_TEXT).first().waitFor();
		if (JSON.stringify((await api("GET", "/settings/runtime/ddns")).values) !== JSON.stringify(before.values))
			throw new Error("a refused save changed the settings");
		if (errors.length > 0) throw new Error(`page error: ${errors[0]}`);
	} finally {
		await cleanUp(api);
	}
}

export const ddnsFlows = [
	{ name: "dynamic dns", run: dynamicDns },
	{ name: "dynamic dns settings", run: dynamicDnsSettings },
];
