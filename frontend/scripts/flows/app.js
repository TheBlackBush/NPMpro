// A settings save with its toast, the CrowdSec section, the phone layout of a host list, the MFA and help windows, and
// the language switch (last: it reloads the page).
import langs from "../../translations/lang-list.json" with { type: "json" };
import de from "../../translations/ui/de.json" with { type: "json" };
import {
	ADMIN_EMAIL,
	cleanUp,
	revealRow,
	rowOf,
	rowShows,
	signIn,
	VIEWER_EMAIL,
	windowClosed,
	withToast,
} from "./lib.js";

// the German strings are a chunk of their own, named after de.json
const GERMAN_CHUNK = /\/assets\/de-[\w-]+\.js$/u;
const SWITCH = "#runtime-logNotFound";
// a switch is a checkbox input or a button with aria-checked
const switchOn = (selector) => {
	const el = document.querySelector(selector);
	return el.type === "checkbox" ? el.checked : el.getAttribute("aria-checked") === "true";
};

const storedSwitch = async (api) => (await api("GET", "/settings/runtime/nginx")).log_not_found;

async function settingsSave({ admin }) {
	const { page, api } = admin;
	const before = await storedSwitch(api);
	try {
		await page.goto("/settings/nginx");
		const toggle = page.locator(SWITCH);
		await toggle.waitFor();
		if ((await page.evaluate(switchOn, SWITCH)) !== before)
			throw new Error("the page shows another value than the stored one");
		// on and back: each save is read back from the API, the second restores the setting
		for (const wanted of [!before, before]) {
			// biome-ignore lint/performance/noAwaitInLoops: one save after the other
			await toggle.click();
			await withToast(page, "Setting has been saved", () =>
				page.locator("form").getByRole("button", { name: "Save", exact: true }).click(),
			);
			const stored = await storedSwitch(api);
			if (stored !== wanted) throw new Error(`the saved setting is ${stored}, expected ${wanted}`);
		}
		await page.reload();
		await page.locator(SWITCH).waitFor();
		if ((await page.evaluate(switchOn, SWITCH)) !== before)
			throw new Error("the page shows the setting changed after a reload");
	} finally {
		if ((await storedSwitch(api)) !== before)
			await api("PUT", "/settings/runtime/nginx", { log_not_found: before });
	}
}

const CAPTCHA_EXPIRATION = "#crowdsec-captcha-expiration";

// Settings, CrowdSec: the section opens, Test connection answers with one line per check (the CI instance has no
// CrowdSec, so they fail, which is fine here), and a harmless field (the captcha expiration) is saved and read back.
// The bouncer stays off, so the save never runs the connection test against a CrowdSec this instance does not have.
async function crowdsecSettings({ admin }) {
	const { page, api } = admin;
	const before = await api("GET", "/settings/crowdsec");
	const wanted = before.captcha_expiration === 3600 ? 3601 : 3600;
	try {
		await page.goto("/settings/crowdsec");
		await page.locator("#crowdsec-api-url").waitFor();
		await page.getByRole("button", { name: "Test connection", exact: true }).click();
		await page.locator("[data-crowdsec-check=lapi]").waitFor();
		await page.locator(CAPTCHA_EXPIRATION).fill(String(wanted));
		await withToast(page, "Setting has been saved", () =>
			page.locator("form").getByRole("button", { name: "Save", exact: true }).click(),
		);
		const after = await api("GET", "/settings/crowdsec");
		if (after.captcha_expiration !== wanted) {
			throw new Error(`the saved captcha expiration is ${after.captcha_expiration}, expected ${wanted}`);
		}
		if (after.enabled !== before.enabled) throw new Error("the save changed whether the bouncer is on");
	} finally {
		const now = await api("GET", "/settings/crowdsec");
		if (now.captcha_expiration !== before.captcha_expiration) {
			await api("PUT", "/settings/crowdsec", { captcha_expiration: before.captcha_expiration, force: true });
		}
	}
}

// The phone session signs in first: creating the host reloads nginx, and a login page that opens during a reload can
// wait on its health check for seconds (it shows the form only after the check answers), longer than the wait for a field.
async function phoneList({ browser, base, admin, password }) {
	const phone = await signIn(browser, base, ADMIN_EMAIL, password, { width: 390, height: 844 });
	let host;
	try {
		host = await admin.api("POST", "/nginx/dead-hosts", { domain_names: ["flow-phone.example.com"] });
		const { page } = phone;
		await page.goto("/nginx/404");
		await revealRow(page, "flow-phone.example.com");
		const row = rowOf(page, "flow-phone.example.com");
		await row.first().waitFor();
		// a card: the domain as its title with the TLS summary, the action button; owner and id stay hidden
		await row.getByText("No TLS").filter({ visible: true }).first().waitFor();
		await row
			.getByRole("button", { name: "Actions for flow-phone.example.com" })
			.filter({ visible: true })
			.first()
			.waitFor();
		// the Edit button sits next to the menu button in the card
		await row
			.getByRole("button", { name: "Edit flow-phone.example.com", exact: true })
			.filter({ visible: true })
			.first()
			.waitFor();
		if (await row.locator('[data-label="ID"]').first().isVisible()) throw new Error("the ID cell shows on a phone");
		if (phone.errors.length > 0) throw new Error(`page error on the phone: ${phone.errors[0]}`);
	} finally {
		await phone.context.close();
		if (host) await admin.api("DELETE", `/nginx/dead-hosts/${host.id}`);
	}
}

// the limited flow user: starting the setup stores a pending secret, which goes with the user (the admin would keep it)
async function mfaWindow({ browser, base, viewerPassword }) {
	const viewer = await signIn(browser, base, VIEWER_EMAIL, viewerPassword);
	try {
		const { page } = viewer;
		await page.goto("/");
		await page.locator("header").getByRole("button", { name: "Open user menu" }).click();
		await page.getByRole("menuitem", { name: "MFA", exact: true }).click();
		// the setup step shows the QR code (not the svg icon of the close button); nothing is enabled, Escape ends it
		await page.getByRole("dialog").getByRole("button", { name: "Enable TOTP", exact: true }).click();
		await page.getByRole("dialog").locator("svg[role=img]").first().waitFor();
		await page.keyboard.press("Escape");
		await windowClosed(page);
		await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Open user menu");
		if (viewer.errors.length > 0) throw new Error(`page error for the viewer: ${viewer.errors[0]}`);
	} finally {
		await viewer.context.close();
	}
}

// The Sign-in column of the Users table: the viewer (a password, no OIDC link) shows Local, and its row menu has no
// Unlink OIDC, which only a linked user offers (R5). The API cannot link a user, so the live check covers a linked row.
async function usersSignIn({ admin }) {
	const { page } = admin;
	await page.goto("/settings/users");
	await rowShows(page, "Flow Viewer", "Local");
	await page.getByRole("button", { name: "Actions for Flow Viewer", exact: true }).filter({ visible: true }).click();
	await page.getByRole("menuitem", { name: "Revoke sessions", exact: true }).waitFor();
	if ((await page.getByRole("menuitem", { name: "Unlink OIDC", exact: true }).count()) > 0)
		throw new Error("Unlink OIDC is offered for a user without an OIDC link");
	await page.keyboard.press("Escape");
}

// A window opened with the mouse focuses its first element, and closing it gives the focus back to the button that
// opened it; neither is keyboard focus, so no tooltip may open by itself (the avatar's and the eye button's did).
async function windowFocusTooltip({ admin }) {
	const { page } = admin;
	const noTooltip = async (where) => {
		await page.waitForTimeout(700);
		if ((await page.locator("[data-slot=tooltip-content]").count()) > 0)
			throw new Error(`a tooltip opened by itself ${where}`);
	};
	await page.goto("/settings/audit-log");
	await page.locator('button[aria-label^="Details: "]').filter({ visible: true }).first().click();
	await page.getByRole("dialog").waitFor();
	await noTooltip("when the event details window opened");
	await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();
	await windowClosed(page);
	await noTooltip("on the button the closed window gave the focus back to");
	await page.goto("/settings/users");
	await page.getByRole("button", { name: "Edit Flow Viewer", exact: true }).filter({ visible: true }).click();
	await page.getByRole("dialog").waitFor();
	await noTooltip("when the user window opened");
	await page.keyboard.press("Escape");
	await windowClosed(page);
}

const PAGE_NAMES = Array.from({ length: 27 }, (_, index) => `flow-page-${String(index + 1).padStart(2, "0")}`);
const SIZE_KEY = "npmpro-page-size-access-lists";

// the names the visible rows' Edit buttons carry, in row order
const rowNames = (page) =>
	page
		.locator("tbody tr")
		.filter({ visible: true })
		.locator("[data-row-edit]:visible")
		.evaluateAll((buttons) =>
			buttons.map((button) => {
				const label = button.getAttribute("aria-label");
				return label.startsWith("Edit ") ? label.slice("Edit ".length) : label;
			}),
		);

// 27 access lists: the paging bars, page 2 in the same sort, the rows per page choice, a search back to page 1, and
// the choice kept over a reload
async function listPaging({ admin }) {
	const { page, api } = admin;
	try {
		for (const name of PAGE_NAMES) {
			// biome-ignore lint/performance/noAwaitInLoops: one request after another
			await api("POST", "/nginx/access-lists", {
				name,
				satisfy_any: true,
				items: [{ username: "flow", password: "flow-password-1" }],
				clients: [{ address: "10.0.0.0/8", directive: "allow" }],
			});
		}
		const total = PAGE_NAMES.length;
		await page.goto("/access");
		await page.evaluate((key) => localStorage.removeItem(key), SIZE_KEY);
		await page.reload();
		// other access lists may exist: the flow works on its own 27
		await page.getByRole("textbox", { name: "Search", exact: true }).fill("flow-page-");
		const bars = page.locator("[data-slot=table-pagination]");
		const size = page.getByRole("combobox", { name: "Rows per page" }).first();
		await bars.first().waitFor();
		if ((await bars.count()) !== 2) throw new Error("the list does not show a paging bar above and below");
		await size.filter({ hasText: "25" }).waitFor();
		// the search filters after a short delay: read the rows once the bar counts only the flow's lists
		await bars.first().getByText(`Showing 1 to 25 of ${total}`, { exact: true }).waitFor();
		const first = await rowNames(page);
		if (first.length !== 25) throw new Error(`the first page shows ${first.length} rows, expected 25`);

		// page 2 from the bar below: the next rows
		await bars.last().getByRole("button", { name: "Page 2", exact: true }).click();
		await bars.first().getByText(`Showing 26 to ${total} of ${total}`, { exact: true }).waitFor();
		const second = await rowNames(page);
		if (second.length !== total - 25 || second.some((name) => first.includes(name)))
			throw new Error("page 2 does not show the next rows");
		const flowNames = [...first, ...second].filter((name) => name.startsWith("flow-page-"));
		if (flowNames.join() !== PAGE_NAMES.join()) throw new Error("the pages are not in the sort of the list");

		// a new size: back to page 1 with that many rows
		await size.click();
		await page.getByRole("option", { name: "10", exact: true }).click();
		await bars.first().getByText(`Showing 1 to 10 of ${total}`, { exact: true }).waitFor();
		if ((await rowNames(page)).length !== 10) throw new Error("a new size does not show that many rows");
		await bars.first().locator('[aria-current="page"]').filter({ hasText: "1" }).waitFor();

		// a search from page 2: back to page 1
		await bars.first().getByRole("button", { name: "Page 2", exact: true }).click();
		await bars.first().getByText(`Showing 11 to 20 of ${total}`, { exact: true }).waitFor();
		await page.getByRole("textbox", { name: "Search", exact: true }).fill("flow-page");
		await bars.first().getByText("Showing 1 to 10 of 27", { exact: true }).waitFor();

		// the choice survives a reload
		await page.reload();
		await bars.first().waitFor();
		await size.filter({ hasText: "10" }).waitFor();
		if ((await rowNames(page)).length !== 10) throw new Error("the size was not kept over a reload");
	} finally {
		await page.evaluate((key) => localStorage.removeItem(key), SIZE_KEY).catch(() => undefined);
		await cleanUp(api);
	}
}

async function helpSheet({ admin }) {
	const { page } = admin;
	await page.goto("/nginx/proxy");
	await page.getByRole("button", { name: "Help", exact: true }).first().click();
	await page.locator("[data-slot=sheet-content] .prose").getByRole("heading").first().waitFor();
	await page.keyboard.press("Escape");
	await windowClosed(page);
}

async function languageSwitch({ admin }) {
	const { page } = admin;
	try {
		await page.goto("/nginx/proxy");
		await page.locator("header").getByRole("button", { name: "Select language" }).click();
		await Promise.all([
			page.waitForEvent("load"),
			page.getByRole("menuitemradio", { name: langs.de.name, exact: true }).click(),
		]);
		await page.locator("html[lang=de]").waitFor({ state: "attached" });
		await page.locator("[data-list-heading]").filter({ hasText: de["proxy-hosts"] }).waitFor();
		await page.locator("header").getByRole("button", { name: de["aria.select-language"] }).click();
		await Promise.all([
			page.waitForEvent("load"),
			page.getByRole("menuitemradio", { name: langs.en.name, exact: true }).click(),
		]);
		await page.locator("html[lang=en]").waitFor({ state: "attached" });
		await page.locator("[data-list-heading]").filter({ hasText: "Proxy Hosts" }).waitFor();
	} finally {
		await page.evaluate(() => localStorage.setItem("locale", "en"));
	}
}

// The German strings cannot be fetched: the app still starts, in English
async function languageFallback({ browser, base, password }) {
	const session = await signIn(browser, base, ADMIN_EMAIL, password);
	try {
		const { page, context } = session;
		await page.evaluate(() => localStorage.setItem("locale", "de"));
		await context.route(GERMAN_CHUNK, (route) => route.abort());
		await page.goto("/nginx/proxy");
		await page.locator("[data-list-heading]").filter({ hasText: "Proxy Hosts" }).waitFor();
		if (session.errors.length > 0) throw new Error(`page error: ${session.errors[0]}`);
	} finally {
		await session.context.close();
	}
}

export const appFlows = [
	{ name: "settings save", run: settingsSave },
	{ name: "crowdsec settings", run: crowdsecSettings },
	{ name: "phone list", run: phoneList },
	{ name: "mfa window", run: mfaWindow },
	{ name: "users sign-in", run: usersSignIn },
	{ name: "window focus tooltip", run: windowFocusTooltip },
	{ name: "help sheet", run: helpSheet },
	{ name: "list paging", run: listPaging },
	{ name: "language fallback", run: languageFallback },
	{ name: "language", run: languageSwitch },
];
