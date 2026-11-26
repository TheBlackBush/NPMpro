// Settings, Notifications: the mail server card (locked by SMTP_HOST in the smoke test, free elsewhere), Send test mail,
// the public URL with its checks and the default mail language. The flow leaves the stored settings as it found them.
import langs from "../../translations/lang-list.json" with { type: "json" };
import { ADMIN_EMAIL, withToast } from "./lib.js";

const HOST = "#email-host";
const PUBLIC_URL = "#notifications-public-url";
const LANGUAGE = "#notifications-default-language";
const SAVED = "Setting has been saved";
const BLOCKED = /resolves to an address outbound requests may not reach/u;

const saveButton = (page) => page.locator("form").getByRole("button", { name: "Save", exact: true });
const storedNotifications = (api) => api("GET", "/settings/notifications");

// the mail server card: with SMTP_HOST the Host is locked and says so; without it a host the guard refuses (the
// loopback address) is refused at save and the form stays unsaved
async function mailServerCard(page, locked) {
	const host = page.locator(HOST);
	if (locked) {
		if (!(await host.isDisabled())) throw new Error("the Host is not locked although SMTP_HOST is set");
		await page.getByText("Set by environment").first().waitFor({ timeout: 5000 });
		return;
	}
	console.log("notifications settings: the mail server is not locked here (no SMTP_HOST)");
	await host.fill("127.0.0.1");
	await page.locator("#email-from-address").fill("flow@example.com");
	await saveButton(page).click();
	await page.getByText(BLOCKED).first().waitFor({ timeout: 10_000 });
}

// Send test mail: the window opens with the signed-in user's address; the refused or failed send shows inside the window
async function testMailWindow(page, locked) {
	const open = page.getByRole("button", { name: "Send test mail", exact: true });
	if (!locked) {
		if ((await open.count()) > 0) throw new Error("Send test mail shows although the mail server is not saved");
		console.log("notifications settings: no test mail without a saved mail server");
		return;
	}
	await open.click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("heading", { name: "Send test mail", exact: true }).waitFor();
	if ((await dialog.locator("#test-mail-to").inputValue()) !== ADMIN_EMAIL)
		throw new Error("the test mail window does not start with the user's address");
	await dialog.getByRole("button", { name: "Send", exact: true }).click();
	// the smoke test's host is the loopback address, which the guard refuses; a live server answers a toast instead
	const answer = await Promise.race([
		dialog
			.getByText(BLOCKED)
			.first()
			.waitFor({ timeout: 20_000 })
			.then(() => "guard"),
		page
			.locator("[data-sonner-toast]")
			.filter({ hasText: "A test mail was sent" })
			.first()
			.waitFor({ timeout: 20_000 })
			.then(() => "sent"),
	]);
	console.log(
		`notifications settings: the test mail answer: ${answer === "guard" ? "refused by the guard" : "sent"}`,
	);
	if (answer === "guard") await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.getByRole("dialog").waitFor({ state: "detached", timeout: 5000 });
}

// the public URL: an http address is marked invalid, the browser's address fills in on https, https://flow.example is
// saved and shown again after a reload
async function publicUrl(page, api, before) {
	const field = page.locator(PUBLIC_URL);
	if (await field.isDisabled()) {
		console.log("notifications settings: the public URL is locked here");
		return;
	}
	await field.fill("http://flow.example");
	await field.press("Tab");
	await page.locator(`${PUBLIC_URL}[aria-invalid="true"]`).waitFor({ timeout: 5000 });
	const useBrowser = page.getByRole("button", { name: "Use this browser's address", exact: true });
	const origin = new URL(page.url()).origin;
	if (origin.startsWith("https://")) {
		await useBrowser.click();
		if ((await field.inputValue()) !== origin)
			throw new Error("Use this browser's address did not fill the origin");
	} else {
		if (!(await useBrowser.isDisabled())) throw new Error("Use this browser's address is enabled on http");
		console.log("notifications settings: the page is on http, the browser's address is disabled");
	}
	await field.fill("https://flow.example");
	await withToast(page, SAVED, () => saveButton(page).click());
	if ((await storedNotifications(api)).public_url !== "https://flow.example")
		throw new Error("the public URL was not saved");
	await page.reload();
	await page.locator(PUBLIC_URL).waitFor();
	if ((await page.locator(PUBLIC_URL).inputValue()) !== "https://flow.example")
		throw new Error("the page does not show the public URL after a reload");
	await page.locator(PUBLIC_URL).fill(before.public_url ?? "");
	await withToast(page, SAVED, () => saveButton(page).click());
	if ((await storedNotifications(api)).public_url !== (before.public_url ?? ""))
		throw new Error("the public URL was not set back");
}

// picks an entry of a select list by its label
async function choose(page, select, name) {
	await select.click();
	await page.getByRole("option", { name, exact: true }).click();
}

// the default mail language: German is saved, then the stored one again
async function defaultLanguage(page, api, before) {
	const select = page.locator(LANGUAGE);
	if (await select.isDisabled()) {
		console.log("notifications settings: the default mail language is locked here");
		return;
	}
	await choose(page, select, langs.de.name);
	await withToast(page, SAVED, () => saveButton(page).click());
	if ((await storedNotifications(api)).default_language !== "de") throw new Error("German was not saved");
	await choose(page, select, langs[before.default_language].name);
	await withToast(page, SAVED, () => saveButton(page).click());
	if ((await storedNotifications(api)).default_language !== before.default_language)
		throw new Error("the default mail language was not set back");
}

async function notificationsSettings({ admin }) {
	const { page, api } = admin;
	const before = await storedNotifications(api);
	const email = await api("GET", "/settings/email");
	try {
		await page.goto("/settings/notifications");
		await page.locator(HOST).waitFor();
		const locked = email.locked.includes("host");
		await mailServerCard(page, locked);
		await testMailWindow(page, locked);
		if (!locked) await page.reload();
		await page.locator(PUBLIC_URL).waitFor();
		await publicUrl(page, api, before);
		await defaultLanguage(page, api, before);
	} finally {
		const now = await storedNotifications(api);
		const restore = {};
		for (const key of ["public_url", "default_language"]) {
			if (!before.locked.includes(key) && now[key] !== before[key]) restore[key] = before[key];
		}
		if (Object.keys(restore).length > 0) await api("PUT", "/settings/notifications", restore);
	}
}

export const notificationsFlows = [{ name: "notifications settings", run: notificationsSettings }];
