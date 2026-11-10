// A settings save with its toast, the phone layout of a host list, the MFA and help windows, and the language switch
// (last: it reloads the page).
import langs from "../../translations/lang-list.json" with { type: "json" };
import de from "../../translations/ui/de.json" with { type: "json" };
import { ADMIN_EMAIL, rowOf, signIn, windowClosed, withToast } from "./lib.js";

const SWITCH = "#runtime-logNotFound";
// a switch is a checkbox input or a button with aria-checked
const switchOn = (selector) => {
	const el = document.querySelector(selector);
	return el.type === "checkbox" ? el.checked : el.getAttribute("aria-checked") === "true";
};

async function settingsSave({ admin }) {
	const { page } = admin;
	await page.goto("/settings/nginx");
	const toggle = page.locator(SWITCH);
	await toggle.waitFor();
	const before = await page.evaluate(switchOn, SWITCH);
	// on and back: the second save restores the setting
	for (const wanted of [!before, before]) {
		// biome-ignore lint/performance/noAwaitInLoops: one save after the other
		await toggle.click();
		await withToast(page, "Setting has been saved", () =>
			page.locator("form").getByRole("button", { name: "Save", exact: true }).click(),
		);
		await page.waitForFunction(
			([selector, value]) => {
				const el = document.querySelector(selector);
				return (el.type === "checkbox" ? el.checked : el.getAttribute("aria-checked") === "true") === value;
			},
			[SWITCH, wanted],
		);
	}
}

async function phoneList({ browser, base, admin, password }) {
	const host = await admin.api("POST", "/nginx/dead-hosts", { domain_names: ["flow-phone.example.com"] });
	const phone = await signIn(browser, base, ADMIN_EMAIL, password, { width: 390, height: 844 });
	try {
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
		if (await row.locator('[data-label="ID"]').first().isVisible()) throw new Error("the ID cell shows on a phone");
	} finally {
		await phone.context.close();
		await admin.api("DELETE", `/nginx/dead-hosts/${host.id}`);
	}
}

async function mfaWindow({ admin }) {
	const { page } = admin;
	await page.goto("/");
	await page.locator("header").getByRole("button", { name: "Open user menu" }).click();
	await page.getByRole("menuitem", { name: "MFA", exact: true }).click();
	await page.getByRole("dialog").locator("svg, canvas").first().waitFor();
	await page.keyboard.press("Escape");
	await windowClosed(page);
	await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Open user menu");
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
