// A settings save with its toast, the phone layout of a host list, the MFA and help windows, and the language switch
// (last: it reloads the page).
import langs from "../../translations/lang-list.json" with { type: "json" };
import de from "../../translations/ui/de.json" with { type: "json" };
import { ADMIN_EMAIL, rowOf, signIn, VIEWER_EMAIL, windowClosed, withToast } from "./lib.js";

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

// The phone session signs in first: creating the host reloads nginx, and a login page that opens during a reload can
// wait on its health check for seconds (it shows the form only after the check answers), longer than the wait for a field.
async function phoneList({ browser, base, admin, password }) {
	const phone = await signIn(browser, base, ADMIN_EMAIL, password, { width: 390, height: 844 });
	let host;
	try {
		host = await admin.api("POST", "/nginx/dead-hosts", { domain_names: ["flow-phone.example.com"] });
		const { page } = phone;
		await page.goto("/nginx/404");
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

export const appFlows = [
	{ name: "settings save", run: settingsSave },
	{ name: "phone list", run: phoneList },
	{ name: "mfa window", run: mfaWindow },
	{ name: "help sheet", run: helpSheet },
	{ name: "language", run: languageSwitch },
];
