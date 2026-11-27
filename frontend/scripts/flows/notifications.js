// Settings, Notifications: the mail server card (locked by SMTP_HOST in the smoke test, free elsewhere), Send test mail
// (only with a configured server: SMTP_HOST and SMTP_FROM, or saved settings), the public URL with its checks and the
// default mail language. The flow leaves the stored settings as it found them.

import process from "node:process";
import langs from "../../translations/lang-list.json" with { type: "json" };
import de from "../../translations/ui/de.json" with { type: "json" };
import { ADMIN_EMAIL, withToast } from "./lib.js";

const HOST = "#email-host";
const PUBLIC_URL = "#notifications-public-url";
const LANGUAGE = "#notifications-default-language";
const SAVED = "Setting has been saved";
const NEEDS_URL = /Set the public URL in Settings, Notifications first/u;
const NOTIFICATIONS_PAGE = /\/settings\/notifications$/u;
const INVALID_LINK = "This link is invalid or has expired.";
const TOO_MANY = "Too many requests, try again later.";
const ON_ITS_WAY = /a mail with a link is on its way/u;
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

// Send test mail: the window opens with the signed-in user's address; the refused or failed send shows inside the window.
// The button needs a configured server (a host and a sender, as SMTP_HOST and SMTP_FROM give the smoke test)
async function testMailWindow(page, configured) {
	const open = page.getByRole("button", { name: "Send test mail", exact: true });
	if (!configured) {
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

const ALERTS_TITLE = "#notifications-alerts-title";
const ALERT_ADDRESS = "flow-alerts@example.com";
const ALERT_ADDRESS_TWO = "flow-alerts-two@example.com";
const HOST_ERROR_EVENT = "#alert-event-host-config-error";

// types an address into the chip input and presses Enter or a comma
async function typeAddress(page, text, key) {
	const input = page.locator("#alerts-addresses");
	await input.fill(text);
	await input.press(key);
}

const removeChip = (page, address) =>
	page.getByRole("button", { name: `Remove ${address}`, exact: true }).filter({ visible: true });

// the Mail alerts card (only with a configured mail server): an address is added with Enter and another with a comma,
// a bad one is refused before the save, both chips are removed by their buttons; the Host config errors event is turned
// off, saved, shown off after a reload, turned on and saved; Send a sample answers with the guard (the smoke test's
// loopback host) or a sent toast. The flow sends 2 of the 5 test requests a minute (this sample and the test mail)
async function mailAlerts(page, api, configured) {
	if (!configured) {
		if ((await page.locator(ALERTS_TITLE).count()) > 0)
			throw new Error("the Mail alerts card shows without a mail server");
		console.log("notifications settings: no Mail alerts card without a mail server");
		return;
	}
	await page.locator(ALERTS_TITLE).filter({ hasText: "Mail alerts" }).waitFor();
	await typeAddress(page, ALERT_ADDRESS, "Enter");
	await typeAddress(page, ALERT_ADDRESS_TWO, ",");
	await Promise.all([ALERT_ADDRESS, ALERT_ADDRESS_TWO].map((address) => removeChip(page, address).first().waitFor()));
	// the bad address is not taken as a chip and the save is refused with its message
	await typeAddress(page, "bad@", "Enter");
	if ((await removeChip(page, "bad@").count()) > 0) throw new Error("bad@ was taken as an address chip");
	await saveButton(page).click();
	await page
		.getByText("bad@ is not a valid address.", { exact: false })
		.filter({ visible: true })
		.first()
		.waitFor({ timeout: 5000 });
	if ((await storedNotifications(api)).alerts_addresses.includes("bad@")) throw new Error("bad@ was saved");
	await page.locator("#alerts-addresses").fill("");
	await removeChip(page, ALERT_ADDRESS).first().click();
	await removeChip(page, ALERT_ADDRESS).first().waitFor({ state: "detached" });
	await removeChip(page, ALERT_ADDRESS_TWO).first().click();
	await removeChip(page, ALERT_ADDRESS_TWO).first().waitFor({ state: "detached" });
	// the event: off and saved, off after a reload, on again and saved
	const event = page.locator(HOST_ERROR_EVENT);
	await event.waitFor();
	const wasOn = await event.isChecked();
	const set = async (on) => {
		const toggle = page.locator(HOST_ERROR_EVENT);
		if ((await toggle.isChecked()) !== on) await toggle.setChecked(on);
		await withToast(page, SAVED, () => saveButton(page).click());
	};
	try {
		await set(!wasOn);
		await page.reload();
		await page.locator(HOST_ERROR_EVENT).waitFor();
		if ((await page.locator(HOST_ERROR_EVENT).isChecked()) === wasOn)
			throw new Error("the Host config errors switch is not shown changed after a reload");
	} finally {
		// restoring must not hide the error that sent us here
		try {
			if ((await page.locator(HOST_ERROR_EVENT).isChecked()) !== wasOn) await set(wasOn);
		} catch (restoreError) {
			console.log(`mail alerts: the Host config errors switch was not restored (${restoreError.message})`);
		}
	}
	if ((await storedNotifications(api)).alerts_addresses.length > 0)
		throw new Error("the alert addresses were not removed");
	await sampleAlert(page);
}

// Send a sample: the guard error of a loopback host, or the sent toast of a live server; the limiter's answer is not
// accepted
async function sampleAlert(page) {
	await page.getByRole("button", { name: "Send a sample", exact: true }).click();
	const answer = await Promise.race([
		page
			.getByText(BLOCKED)
			.filter({ visible: true })
			.first()
			.waitFor({ timeout: 20_000 })
			.then(() => "guard"),
		page
			.locator("[data-sonner-toast]")
			.filter({ hasText: "A sample alert was sent" })
			.first()
			.waitFor({ timeout: 20_000 })
			.then(() => "sent"),
		page
			.getByText(TOO_MANY, { exact: true })
			.filter({ visible: true })
			.first()
			.waitFor({ timeout: 20_000 })
			.then(() => "limited"),
	]);
	if (answer === "limited") throw new Error("the sample alert was answered by the limiter");
	console.log(
		`notifications settings: the sample alert answer: ${answer === "guard" ? "refused by the guard" : "sent"}`,
	);
}

const NOTICES = "#email-account-notices";

// the Account notices switch of the Mail server card: off and saved, off after a reload, on again and saved; the
// stored value is put back at the end
async function accountNotices(page, api) {
	const toggle = () => page.locator(NOTICES);
	await toggle().waitFor();
	if (await toggle().isDisabled()) {
		console.log("notifications settings: the Account notices switch is locked here");
		return;
	}
	const was = await toggle().isChecked();
	const stored = async () => (await api("GET", "/settings/email")).account_notices;
	const set = async (on) => {
		if ((await toggle().isChecked()) !== on) await toggle().setChecked(on);
		await withToast(page, SAVED, () => saveButton(page).click());
	};
	try {
		await set(false);
		if ((await stored()) !== false) throw new Error("Account notices was not saved as off");
		await page.reload();
		await toggle().waitFor();
		if (await toggle().isChecked()) throw new Error("Account notices shows on after it was saved off and reloaded");
		await set(true);
		if ((await stored()) !== true) throw new Error("Account notices was not saved as on");
	} finally {
		try {
			await page.reload();
			await toggle().waitFor();
			if ((await toggle().isChecked()) !== was) await set(was);
		} catch (restoreError) {
			console.log(`notifications settings: Account notices was not restored (${restoreError.message})`);
		}
	}
}

async function notificationsSettings({ admin }) {
	const { page, api } = admin;
	const before = await storedNotifications(api);
	const email = await api("GET", "/settings/email");
	try {
		await page.goto("/settings/notifications");
		await page.locator(HOST).waitFor();
		const locked = email.locked.includes("host");
		// the saved settings first: the card below leaves the form unsaved when the host is not locked
		await testMailWindow(page, email.configured);
		await mailServerCard(page, locked);
		if (!locked) await page.reload();
		await page.locator(PUBLIC_URL).waitFor();
		await publicUrl(page, api, before);
		await defaultLanguage(page, api, before);
		await mailAlerts(page, api, email.configured);
		await page.reload();
		await page.locator(HOST).waitFor();
		await accountNotices(page, api);
	} finally {
		const now = await storedNotifications(api);
		const restore = {};
		for (const key of ["public_url", "default_language", "alerts_addresses", "alerts_events"]) {
			if (!before.locked.includes(key) && JSON.stringify(now[key]) !== JSON.stringify(before[key]))
				restore[key] = before[key];
		}
		if (Object.keys(restore).length > 0) await api("PUT", "/settings/notifications", restore);
	}
}

// Settings, Authentication: the reset line is shown with a configured mail server; without a public URL its switch is
// disabled and the note links to Settings, Notifications
async function resetSwitchLine(admin) {
	const { page, api } = admin;
	const email = await api("GET", "/settings/email");
	const notifications = await storedNotifications(api);
	await page.goto("/settings/authentication");
	const line = page.locator("#oidc-allowPasswordReset");
	// the Sign-in rules card is collapsed until it is opened
	const rules = page.locator("[id$=-trigger]").filter({ hasText: "Sign-in rules" });
	await rules.waitFor();
	if ((await rules.getAttribute("aria-expanded")) === "false") await rules.click();
	if (!email.configured) {
		if ((await line.count()) > 0) throw new Error("the reset line shows without a configured mail server");
		console.log("password reset: no mail server here, the Authentication line is hidden");
		return;
	}
	await line.waitFor();
	if (notifications.public_url) {
		console.log("password reset: a public URL is set here, the switch is not checked as disabled");
		return;
	}
	if (!(await line.isDisabled())) throw new Error("the reset switch is enabled without a public URL");
	const note = page.getByRole("link", { name: NEEDS_URL });
	await note.click();
	await page.waitForURL(NOTIFICATIONS_PAGE);
	await page.locator(PUBLIC_URL).waitFor();
}

// the language menu of the pages without a session: German, the reload keeps the invalid-link message, English again
async function switchResetLanguage(page, checks) {
	// a reload that lost the token shows the same text without any request, so each reload must bring a new check
	// call that carries the token
	const expectCheck = (before, step) => {
		if (checks.length <= before || checks.at(-1) !== "x")
			throw new Error(`no check call with the token after ${step} (calls: ${JSON.stringify(checks)})`);
	};
	const menu = (name) => page.getByRole("button", { name }).first();
	const afterReload = checks.length;
	await menu("Select language").click();
	await Promise.all([
		page.waitForEvent("load"),
		page.getByRole("menuitemradio", { name: langs.de.name, exact: true }).click(),
	]);
	await page.locator("html[lang=de]").waitFor({ state: "attached" });
	await page.getByText(de["error.reset-invalid"], { exact: true }).waitFor();
	expectCheck(afterReload, "the switch to German");
	if (page.url().includes("token")) throw new Error("the token is back in the address after the language switch");
	const afterGerman = checks.length;
	await menu(de["aria.select-language"]).click();
	await Promise.all([
		page.waitForEvent("load"),
		page.getByRole("menuitemradio", { name: langs.en.name, exact: true }).click(),
	]);
	await page.locator("html[lang=en]").waitFor({ state: "attached" });
	await page.getByText(INVALID_LINK, { exact: true }).waitFor();
	expectCheck(afterGerman, "the switch back to English");
}

// The reset routes share a limit of 5 requests per address in 15 minutes and the user routes count 5 refused requests
// (every page load without a session asks for the user) in 5 minutes, so the flow keeps both low: the real token check
// runs once (the reloads of the language switch answer from a stub that gives the same refusal), one real request for
// an unknown address, and the one sign-in at the end is on the login page loaded last. An answer of the limit itself
// is logged only on a marked rerun (FLOWS_RERUN=1); otherwise a limit or a wrong status fails the flow.
// biome-ignore lint/style/noProcessEnv: a rerun of the flows on the same instance is marked from the command line
const RERUN = process.env.FLOWS_RERUN === "1";
const STUB_REFUSAL = {
	status: 400,
	contentType: "application/json",
	body: JSON.stringify({ error: { code: 400, message: "invalid", message_i18n: "error.reset-invalid" } }),
};

// the pages of a password reset by mail without a session: the login page (a link to the reset only when the switch is
// on), the reset page with a wrong token (the address bar loses the fragment, the language switch keeps the message),
// the forgot page with an unknown address and the sign-in again
async function pagesWithoutSession({ browser, base, password, offered }) {
	const context = await browser.newContext({
		ignoreHTTPSErrors: true,
		locale: "en-US",
		viewport: { width: 1440, height: 900 },
		baseURL: base,
	});
	const page = await context.newPage();
	page.setDefaultTimeout(15_000);
	page.setDefaultNavigationTimeout(30_000);
	try {
		const checkResponse = page.waitForResponse((r) => r.url().includes("/api/password-reset/check"));
		await page.goto("/reset-password#token=x");
		const checkStatus = (await checkResponse).status();
		if (checkStatus !== 400 && !(RERUN && checkStatus === 429))
			throw new Error(`the real token check answered ${checkStatus}, expected 400`);
		const answer = await Promise.race([
			page
				.getByText(INVALID_LINK, { exact: true })
				.waitFor()
				.then(() => "invalid"),
			page
				.getByText(TOO_MANY, { exact: true })
				.waitFor()
				.then(() => "limited"),
		]);
		if (page.url().includes("#") || page.url().includes("token"))
			throw new Error(`the address bar still shows the token: ${new URL(page.url()).pathname}`);
		if (answer === "limited" && !RERUN) throw new Error("the wrong token was answered by the limit (not a rerun)");
		console.log(
			`password reset: the wrong token is ${answer === "invalid" ? "refused as invalid" : "answered by the limit"}`,
		);
		const checks = [];
		await context.route("**/api/password-reset/check", (route) => {
			checks.push(route.request().postDataJSON()?.token);
			return route.fulfill(STUB_REFUSAL);
		});
		await page.reload();
		await page.getByText(INVALID_LINK, { exact: true }).waitFor();
		if (checks.length !== 1 || checks[0] !== "x")
			throw new Error(`no check call with the token after the reload (calls: ${JSON.stringify(checks)})`);
		await switchResetLanguage(page, checks);
		await context.unroute("**/api/password-reset/check");

		await page.goto("/forgot-password");
		await page.locator("#forgot-email").fill("flow-nobody@example.com");
		const sendResponse = page.waitForResponse(
			(r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/password-reset",
		);
		await page.getByRole("button", { name: "Send", exact: true }).click();
		const sendStatus = (await sendResponse).status();
		if (sendStatus >= 500 || (sendStatus === 429 && !RERUN))
			throw new Error(`the reset request answered ${sendStatus}`);
		const sent = await Promise.race([
			page
				.getByText(ON_ITS_WAY)
				.waitFor()
				.then(() => "sent"),
			page
				.getByText(TOO_MANY, { exact: true })
				.waitFor()
				.then(() => "limited"),
		]);
		if (sent === "limited" && !RERUN) throw new Error("the reset request was answered by the limit (not a rerun)");
		console.log(
			`password reset: an unknown address is ${sent === "sent" ? "answered as on its way" : "answered by the limit"}`,
		);

		await page.goto("/login");
		await page.locator("#login-email").waitFor();
		const link = (await page.getByRole("link", { name: "Forgot password?" }).count()) > 0;
		if (link !== offered) throw new Error(`the login page offers the reset (${link}), the switch is ${offered}`);
		console.log(`password reset: the login page ${link ? "offers" : "has no"} "Forgot password?"`);
		await page.locator("#login-email").fill(ADMIN_EMAIL);
		await page.locator("#login-password").fill(password);
		await page.locator("form button[type=submit]").click();
		await page.locator("#login-email").waitFor({ state: "detached" });
	} finally {
		await context.close();
	}
}

async function passwordReset({ admin, browser, base, password }) {
	await resetSwitchLine(admin);
	const offered = (await admin.api("GET", "/settings/email")).allow_password_reset === true;
	await pagesWithoutSession({ browser, base, password, offered });
}

export const notificationsFlows = [
	{ name: "notifications settings", run: notificationsSettings },
	{ name: "password reset", run: passwordReset },
];
