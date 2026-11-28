// A settings save with its toast, the CrowdSec section, a refused save that opens a collapsed card, the Landing pages
// section (with the visit time choices), the phone layout of a host list, the MFA and help windows, and the language
// switch (last: it reloads the page).
import { request } from "playwright";
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
	windowTitled,
	withToast,
} from "./lib.js";

// the German strings are a chunk of their own, named after de.json
const TAG_B_URL = /[?&]tag=flow-b(?:&|$)/u;
const TAGS_BUTTON = /^Tags: /u;
const BOTH_TAGS_URL = /tag=flow-b&tag=flow-a/u;
const GERMAN_CHUNK = /\/assets\/de-[\w-]+\.js$/u;
const API_TOKEN = /^npmpro_[0-9a-f]{16}_[\w-]{43}$/u;
// valid on purpose: the body is checked before the permission, so only a permission refusal answers 403
const TOKEN_HOST = {
	domain_names: ["flow-token.example.com"],
	forward_scheme: "http",
	forward_host: "10.0.0.1",
	forward_port: 8080,
};
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

const WARNING_DAYS = "#runtime-warningDays";
const storedWarningDays = async (api) => (await api("GET", "/settings/runtime/certificates")).warning_days;

// Settings, Certificates: "Warn before expiry" shows the stored 14, 30 is saved and shown again after a reload, 61 is
// out of range: the field is marked invalid and the blocked Save refuses, nothing is stored; 14 is saved again.
async function warningDaysSave({ admin }) {
	const { page, api } = admin;
	const before = await storedWarningDays(api);
	try {
		await page.goto("/settings/certificates");
		const field = page.locator(WARNING_DAYS);
		await field.waitFor();
		if ((await field.inputValue()) !== String(before))
			throw new Error("the page shows another value than the stored one");
		const save = page.locator("form").getByRole("button", { name: "Save", exact: true });
		await field.fill("30");
		await withToast(page, "Setting has been saved", () => save.click());
		if ((await storedWarningDays(api)) !== 30) throw new Error("30 days were not saved");
		await page.reload();
		await page.locator(WARNING_DAYS).waitFor();
		if ((await page.locator(WARNING_DAYS).inputValue()) !== "30")
			throw new Error("the page does not show 30 after a reload");
		await page.locator(WARNING_DAYS).fill("61");
		// the message shows once the field is left
		await page.locator(WARNING_DAYS).press("Tab");
		await page.locator(`${WARNING_DAYS}[aria-invalid="true"]`).waitFor({ timeout: 5000 });
		await page.locator('form button[aria-disabled="true"]', { hasText: "Save" }).waitFor({ timeout: 5000 });
		await save.click({ force: true });
		if ((await storedWarningDays(api)) !== 30) throw new Error("the refused save changed the warning days");
		await page.locator(WARNING_DAYS).fill(String(before));
		await withToast(page, "Setting has been saved", () => save.click());
		if ((await storedWarningDays(api)) !== before) throw new Error("the warning days were not set back");
	} finally {
		if ((await storedWarningDays(api)) !== before)
			await api("PUT", "/settings/runtime/certificates", { warning_days: before });
	}
}

const LOG_FORMAT = "#runtime-logFormat";

const storedLogFormat = async (api) => (await api("GET", "/settings/runtime/logs")).log_format;

// the select shows a format: its trigger text
const formatShown = (page, text) => page.locator(LOG_FORMAT).filter({ hasText: text }).waitFor({ timeout: 5000 });

// Settings, Logs & monitoring: JSON is chosen and saved (toast, read back from the API, shown again after a reload),
// then Classic, so the instance ends as it started
async function logFormat({ admin }) {
	const { page, api } = admin;
	const before = await storedLogFormat(api);
	try {
		await page.goto("/settings/monitoring");
		await page.locator(LOG_FORMAT).waitFor();
		// JSON first, unless it is stored: each step changes the format, and the second restores it
		const steps = [
			["json", "JSON"],
			["classic", "Classic"],
		];
		if (before === "json") steps.reverse();
		for (const [wanted, label] of steps) {
			// biome-ignore lint/performance/noAwaitInLoops: one save after the other
			await page.locator(LOG_FORMAT).click();
			await page.getByRole("option", { name: label, exact: true }).click();
			await withToast(page, "Setting has been saved", () =>
				page.locator("form").getByRole("button", { name: "Save", exact: true }).click(),
			);
			const stored = await storedLogFormat(api);
			if (stored !== wanted) throw new Error(`the saved log format is ${stored}, expected ${wanted}`);
			await page.reload();
			await page.locator(LOG_FORMAT).waitFor();
			await formatShown(page, label);
		}
	} finally {
		if ((await storedLogFormat(api)) !== before) await api("PUT", "/settings/runtime/logs", { log_format: before });
	}
}

const TLS_HANDSHAKE_LOG = "#runtime-tlsHandshakeLog";
const WRITE_LOG_FILES = "#runtime-writeLogFiles";

const storedLogs = (api) => api("GET", "/settings/runtime/logs");

// Settings, Logs & monitoring: with Write log files off the TLS handshake log is off, disabled and explained; with it
// on the switch is saved on (toast, API, checked after a reload) and then off. The instance ends as it started.
async function tlsHandshakeLog({ admin }) {
	const { page, api } = admin;
	const before = await storedLogs(api);
	// set by NGINX_TLS_HANDSHAKE_LOG: nothing to switch
	if (before.locked.includes("tls_handshake_log")) return;
	try {
		await page.goto("/settings/monitoring");
		await page.locator(TLS_HANDSHAKE_LOG).waitFor();
		if (!before.write_log_files) {
			if (!(await page.locator(TLS_HANDSHAKE_LOG).isDisabled()))
				throw new Error("the switch is usable without the log files");
			await page.getByText("Turn on Write log files to use the TLS handshake log.", { exact: true }).waitFor();
			// Write log files locked off by LOGROTATE: the disabled state is all there is to check
			if (before.locked.includes("write_log_files")) return;
			await page.locator(WRITE_LOG_FILES).click();
		}
		for (const wanted of [!before.tls_handshake_log, before.tls_handshake_log]) {
			// biome-ignore lint/performance/noAwaitInLoops: one save after the other
			await page.locator(TLS_HANDSHAKE_LOG).click();
			await withToast(page, "Setting has been saved", () =>
				page.locator("form").getByRole("button", { name: "Save", exact: true }).click(),
			);
			const stored = (await storedLogs(api)).tls_handshake_log;
			if (stored !== wanted) throw new Error(`the saved TLS handshake log is ${stored}, expected ${wanted}`);
			await page.reload();
			await page.locator(TLS_HANDSHAKE_LOG).waitFor();
			if ((await page.evaluate(switchOn, TLS_HANDSHAKE_LOG)) !== wanted)
				throw new Error("the switch does not show the saved value");
		}
	} finally {
		const now = await storedLogs(api);
		const reset = {};
		if (now.tls_handshake_log !== before.tls_handshake_log) reset.tls_handshake_log = before.tls_handshake_log;
		if (now.write_log_files !== before.write_log_files && !before.locked.includes("write_log_files")) {
			reset.write_log_files = before.write_log_files;
		}
		if (Object.keys(reset).length > 0) await api("PUT", "/settings/runtime/logs", reset);
	}
}

const CAPTCHA_EXPIRATION = "#crowdsec-captcha-expiration";

const ADMIN_UI = "#crowdsec-admin-ui";

// Settings, CrowdSec: the section opens, Test connection answers with one line per check (the CI instance has no
// CrowdSec, so they fail, which is fine here), and two harmless fields (the captcha expiration and the Admin UI and
// CrowdSec choice) are saved in one save and read back, the choice also after a reload. The bouncer stays off, so the
// save never runs the connection test against a CrowdSec this instance does not have.
async function crowdsecSettings({ admin }) {
	const { page, api } = admin;
	const before = await api("GET", "/settings/crowdsec");
	const wanted = before.captcha_expiration === 3600 ? 3601 : 3600;
	const [adminUi, adminUiLabel] =
		before.admin_ui === "bans" ? ["checked", "Checked like every host"] : ["bans", "Bans only"];
	try {
		await page.goto("/settings/crowdsec");
		await page.locator("#crowdsec-api-url").waitFor();
		await page.getByRole("button", { name: "Test connection", exact: true }).click();
		await page.locator("[data-crowdsec-check=lapi]").waitFor();
		await page.locator(CAPTCHA_EXPIRATION).fill(String(wanted));
		await page.locator(ADMIN_UI).click();
		await page.getByRole("option", { name: adminUiLabel, exact: true }).click();
		await withToast(page, "Setting has been saved", () =>
			page.locator("form").getByRole("button", { name: "Save", exact: true }).click(),
		);
		const after = await api("GET", "/settings/crowdsec");
		if (after.captcha_expiration !== wanted) {
			throw new Error(`the saved captcha expiration is ${after.captcha_expiration}, expected ${wanted}`);
		}
		if (after.admin_ui !== adminUi)
			throw new Error(`the saved admin UI choice is ${after.admin_ui}, expected ${adminUi}`);
		await page.reload();
		await page.locator(ADMIN_UI).filter({ hasText: adminUiLabel }).waitFor({ timeout: 5000 });
		if (after.enabled !== before.enabled) throw new Error("the save changed whether the bouncer is on");
	} finally {
		const now = await api("GET", "/settings/crowdsec");
		if (now.captcha_expiration !== before.captcha_expiration || now.admin_ui !== before.admin_ui) {
			await api("PUT", "/settings/crowdsec", {
				captcha_expiration: before.captcha_expiration,
				admin_ui: before.admin_ui,
				force: true,
			});
		}
	}
}

const ADVANCED = "#crowdsec-advanced-trigger";
const REQUEST_TIMEOUT = "#crowdsec-request-timeout";

const focusIs = (page, id) => page.waitForFunction((target) => document.activeElement?.id === target, id);

// waits until the Advanced card is open or closed (a re-render may lag behind the click)
const expanded = async (page, expected) => {
	try {
		await page.locator(`${ADVANCED}[aria-expanded="${expected}"]`).waitFor({ timeout: 5000 });
	} catch (err) {
		throw new Error(`the Advanced card is not ${expected ? "open" : "closed"}`, { cause: err });
	}
};

// Settings, CrowdSec: a wrong value in the collapsed Advanced card, which is closed again, is not hidden by a refused
// save: a click on the blocked Save and Enter in a field of another card (the implicit submission clicks the blocked
// Save, the form's default button) both open the card and focus the field. Nothing is saved, and the field gets its
// value back, so the section has no changes when the flow leaves.
async function collapsedCardOpens({ admin }) {
	const { page, api } = admin;
	const before = await api("GET", "/settings/crowdsec");
	await page.goto("/settings/crowdsec");
	await page.locator("#crowdsec-api-url").waitFor();
	await expanded(page, false);
	await page.locator(ADVANCED).click();
	const field = page.locator(REQUEST_TIMEOUT);
	const saved = await field.inputValue();
	await field.fill("5");
	// closing the card leaves the field: its message shows and Save is blocked
	await page.locator(ADVANCED).click();
	await expanded(page, false);
	// the blocked Save is aria-disabled (still clickable), which Playwright counts as not enabled
	const save = page.locator("form").getByRole("button", { name: "Save", exact: true });
	await page.locator('form button[aria-disabled="true"]', { hasText: "Save" }).waitFor({ timeout: 5000 });
	await save.click({ force: true });
	await focusIs(page, "crowdsec-request-timeout");
	await expanded(page, true);
	// the same from the keyboard: Enter in a field of another card
	await page.locator(ADVANCED).click();
	await expanded(page, false);
	await page.locator(CAPTCHA_EXPIRATION).press("Enter");
	await focusIs(page, "crowdsec-request-timeout");
	await expanded(page, true);
	await field.fill(saved);
	const after = await api("GET", "/settings/crowdsec");
	if (after.request_timeout !== before.request_timeout)
		throw new Error("the refused save changed the request timeout");
}

const MAINTENANCE_PAGE = '<!DOCTYPE html><p>flow maintenance <!--# echo var="host" --></p>';

// Settings, Landing pages, Visit time: each choice is saved in the window, and the ban preview, opened in a browser in
// Tokyo (UTC+9, no summer time), shows that choice's text. The expected local text comes from the same browser's Intl,
// so a browser and Node with different time zone data cannot disagree.
const VISIT_TIMES = [
	["local", "Visitor's local time"],
	["local-utc", "Visitor's local time and UTC"],
	["utc", "UTC"],
];
const VISIT_ZONE = "Asia/Tokyo";
const VISIT_FORMAT = {
	year: "numeric",
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	timeZoneName: "short",
};

async function visitTimePreview(admin, base, browser, choice) {
	const context = await browser.newContext({
		ignoreHTTPSErrors: true,
		locale: "en-US",
		timezoneId: VISIT_ZONE,
		baseURL: base,
		storageState: await admin.context.storageState(),
	});
	try {
		const page = await context.newPage();
		await page.goto("/api/settings/landing-pages/preview/npmpro/ban");
		const chip = page.locator("[data-npmpro-time]");
		await chip.waitFor();
		const browserZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
		if (browserZone !== VISIT_ZONE)
			throw new Error(`the preview browser runs in ${browserZone}, not ${VISIT_ZONE}`);
		const text = await chip.textContent();
		const utc = await chip.getAttribute("data-utc");
		const shown = await chip.getAttribute("data-visit-time");
		if (shown !== choice) throw new Error(`the preview carries the visit time ${shown}, expected ${choice}`);
		// the same rule as page-script.js, in the same browser: the UTC date only when the Tokyo date is another day
		// (either case can happen, depending on the hour of the run)
		const [local, utcDate] = await page.evaluate(
			([iso, format]) => {
				const moment = new Date(iso);
				const day = (zone) =>
					new Intl.DateTimeFormat("en", {
						year: "numeric",
						month: "numeric",
						day: "numeric",
						...(zone ? { timeZone: zone } : {}),
					}).format(moment);
				const date =
					day() === day("UTC")
						? ""
						: `${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(moment)}, `;
				return [new Intl.DateTimeFormat("en", format).format(moment), date];
			},
			[utc, VISIT_FORMAT],
		);
		const utcText = `${utc.slice(0, 10)} ${utc.slice(11, 16)} UTC`;
		const expected = { utc: utcText, local, "local-utc": `${local} (${utcDate}${utc.slice(11, 16)} UTC)` }[choice];
		if (text !== expected)
			throw new Error(`visit time ${choice}: the chip shows "${text}", expected "${expected}"`);
	} finally {
		await context.close();
	}
}

// Settings, Landing pages: a custom maintenance page is pasted and saved, the API returns it, the old
// /settings/default-site address leads here, each visit time is saved and read in the ban preview, and the page and
// the visit time are set back
async function landingPagesSettings({ admin, base, browser }) {
	const { page, api } = admin;
	const before = await api("GET", "/settings/landing-pages");
	try {
		await page.goto("/settings/landing-pages");
		// an untouched custom box left and the row set back: no error stays behind to block Save
		await page.locator("#landing-ban").click();
		await page.getByRole("option", { name: "Custom page", exact: true }).click();
		await page.locator("#landing-ban-html").click();
		await page.getByRole("heading", { name: "Landing pages" }).first().click();
		await page.locator("#landing-ban").click();
		await page.getByRole("option", { name: "Access blocked page", exact: true }).click();
		if (await page.getByText("Fix before saving").count()) {
			throw new Error("leaving Custom page kept the HTML field's error");
		}
		await page.locator("#landing-maintenance").click();
		await page.getByRole("option", { name: "Custom page", exact: true }).click();
		await page.locator("#landing-maintenance-html").fill(MAINTENANCE_PAGE);
		await withToast(page, "Setting has been saved", () =>
			page.locator("form").getByRole("button", { name: "Save", exact: true }).click(),
		);
		const after = await api("GET", "/settings/landing-pages");
		if (after.pages.maintenance.choice !== "custom" || after.pages.maintenance.html !== MAINTENANCE_PAGE) {
			throw new Error(`the maintenance page was not saved: ${JSON.stringify(after.pages.maintenance)}`);
		}
		await page.goto("/settings/default-site");
		await page.waitForURL("**/settings/landing-pages");
		await page.locator("#landing-maintenance-html").waitFor();
		if ((await page.locator("#landing-maintenance-html").inputValue()) !== MAINTENANCE_PAGE) {
			throw new Error("the page shows another maintenance page than the saved one");
		}
		// start at the first choice that differs from the saved one, so the select changes and Save is enabled
		const start = Math.max(
			0,
			VISIT_TIMES.findIndex(([choice]) => choice !== before.visit_time),
		);
		for (const [choice, label] of [...VISIT_TIMES.slice(start), ...VISIT_TIMES.slice(0, start)]) {
			// biome-ignore lint/performance/noAwaitInLoops: one save after the other
			await page.locator("#landing-visit-time").click();
			await page.getByRole("option", { name: label, exact: true }).click();
			await withToast(page, "Setting has been saved", () =>
				page.locator("form").getByRole("button", { name: "Save", exact: true }).click(),
			);
			if ((await api("GET", "/settings/landing-pages")).visit_time !== choice) {
				throw new Error(`the visit time ${choice} was not saved`);
			}
			await visitTimePreview(admin, base, browser, choice);
		}
	} finally {
		const { choice, html } = before.pages.maintenance;
		await api("PUT", "/settings/landing-pages", {
			visit_time: before.visit_time,
			pages: { maintenance: choice === "custom" ? { choice, html } : { choice } },
		});
	}
}

// The phone session signs in first: creating the host reloads nginx, and a login page that opens during a reload can
// wait on its health check for seconds (it shows the form only after the check answers), longer than the wait for a
// field.
async function phoneList({ browser, base, admin, password }) {
	const phone = await signIn(browser, base, ADMIN_EMAIL, password, { width: 390, height: 844 });
	let host;
	try {
		host = await admin.api("POST", "/nginx/dead-hosts", {
			domain_names: ["flow-phone.example.com"],
			npmpro_description: "flow phone note",
		});
		const { page } = phone;
		await page.goto("/nginx/404");
		await revealRow(page, "flow-phone.example.com");
		const row = rowOf(page, "flow-phone.example.com");
		await row.first().waitFor();
		// a card: the domain as its title with the TLS summary, the action button; owner and id stay hidden
		await row.getByText("No TLS").filter({ visible: true }).first().waitFor();
		await row.getByText("flow phone note").filter({ visible: true }).first().waitFor();
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
		await openAccount(page, "mfa");
		// the setup step shows the QR code (not the svg icon of the close button); nothing is enabled, Escape ends it
		await page.getByRole("dialog").getByRole("button", { name: "Enable TOTP", exact: true }).click();
		await page.getByRole("dialog").getByRole("img", { name: QR_NAME }).waitFor();
		// a started setup is an unsaved change: the MFA entry has the dot, and Escape asks first
		await page.getByRole("dialog").locator("[data-account-tab=mfa][data-dirty]").waitFor();
		await page.keyboard.press("Escape");
		await page.getByRole("alertdialog").getByRole("button", { name: "Discard changes", exact: true }).click();
		await windowClosed(page);
		await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Open user menu");
		if (viewer.errors.length > 0) throw new Error(`page error for the viewer: ${viewer.errors[0]}`);
	} finally {
		await viewer.context.close();
	}
}

// Opens the Account window from the one user menu entry (it opens on Profile), then the part: through the side list on
// a desktop, through the back arrow and the list row on a phone (where the part takes its heading's focus)
async function openAccount(page, part = "profile") {
	await page
		.locator("header")
		.getByRole("button", { name: "Open user menu" })
		.locator("visible=true")
		.first()
		.click();
	await page.getByRole("menuitem", { name: "Account", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.waitFor();
	if (part === "profile") return;
	const tab = dialog.locator(`[data-account-tab=${part}]`);
	if (await tab.isVisible()) {
		await tab.click();
	} else {
		await dialog.locator("[data-account-back]").click();
		await dialog.locator(`[data-account-row=${part}]`).click();
	}
	await dialog.locator(`[data-account-part=${part}]`).waitFor();
}

// The Account window: the user menu entry opens its part with the focus where the part starts, edits stay when
// switching parts, Close asks before discarding them, an administrator's window of another user has Profile with the
// switches and Sign-in, and a phone drills in from the list of parts
async function accountWindow({ admin, browser, base, viewerPassword }) {
	const viewer = await signIn(browser, base, VIEWER_EMAIL, viewerPassword);
	let phone = null;
	try {
		const { page } = viewer;
		await page.goto("/");
		// the one user menu entry opens the window on Profile; another part is reached through the side list
		// (a desktop) or the back arrow and the list rows (a phone)
		const open = async (target, part = "profile") => {
			await openAccount(target, part);
			return target.getByRole("dialog");
		};
		// the entry opens Profile with the focus in Full Name; every part is reached through the side list
		const first = await open(page);
		await first.locator("[data-account-tab=profile][aria-selected=true]").waitFor();
		await page.waitForFunction(() => document.activeElement?.getAttribute("name") === "name");
		const tabs = await first
			.locator("[data-account-tab]")
			.evaluateAll((tab) => tab.map((t) => t.dataset.accountTab));
		if (tabs.join() !== "profile,password,mfa,api-tokens") throw new Error(`the side list has ${tabs.join()}`);
		// the side list is vertical: ArrowDown moves to the next part, ArrowUp back
		await first.locator("[data-account-tab=profile]").focus();
		await page.keyboard.press("ArrowDown");
		await first.locator("[data-account-tab=password][aria-selected=true]").waitFor();
		await page.keyboard.press("ArrowUp");
		await first.locator("[data-account-tab=profile][aria-selected=true]").waitFor();
		for (const part of ["password", "mfa", "api-tokens"]) {
			// biome-ignore lint/performance/noAwaitInLoops: one part after the other
			await first.locator(`[data-account-tab=${part}]`).click();
			await first.locator(`[data-account-part=${part}]`).waitFor();
		}
		await page.keyboard.press("Escape");
		await windowClosed(page);

		// edits stay across parts; the dot and the footer note name the part with edits
		const dialog = await open(page);
		const name = dialog.locator("input[name=name]");
		await name.fill("Flow Viewer edited");
		await dialog.locator("[data-account-tab=password]").click();
		await dialog.locator("input[name=current]").fill("not-saved");
		await dialog.locator("[data-account-tab=profile][data-dirty]").waitFor();
		await dialog
			.locator("[data-account-unsaved-note]")
			.filter({ hasText: "Profile has unsaved changes" })
			.waitFor();
		await dialog.locator("[data-account-tab=profile]").click();
		if ((await name.inputValue()) !== "Flow Viewer edited") throw new Error("Profile lost its edit");
		await dialog.locator("[data-account-tab=password]").click();
		if ((await dialog.locator("input[name=current]").inputValue()) !== "not-saved")
			throw new Error("Password lost its edit");
		// Close asks: Keep editing keeps both edits, Discard changes closes and saves nothing
		await dialog.getByRole("button", { name: "Close", exact: true }).locator("visible=true").last().click();
		const ask = page.getByRole("alertdialog");
		await ask.getByRole("button", { name: "Keep editing", exact: true }).click();
		await ask.waitFor({ state: "detached" });
		await dialog.locator("[data-account-tab=profile]").click();
		if ((await name.inputValue()) !== "Flow Viewer edited") throw new Error("Keep editing lost the edit");
		await page.keyboard.press("Escape");
		await ask.getByRole("button", { name: "Discard changes", exact: true }).click();
		await windowClosed(page);
		const reopened = await open(page);
		const reopenedName = reopened.locator("input[name=name]");
		await reopenedName.waitFor();
		if ((await reopenedName.inputValue()) !== "Flow Viewer") throw new Error("Discard changes saved the edit");
		await page.keyboard.press("Escape");
		await windowClosed(page);
		if (viewer.errors.length > 0) throw new Error(`page error for the viewer: ${viewer.errors[0]}`);

		// D36: the administrator edits Flow Viewer (no MFA, no OIDC link): "Edit User" with Profile and its two
		// switches and Sign-in, none of the own parts; a confirm window over the frame gives the focus back on Cancel
		const errorsBefore = admin.errors.length;
		const adminPage = admin.page;
		await adminPage.goto("/settings/users");
		await adminPage
			.getByRole("button", { name: "Edit Flow Viewer", exact: true })
			.filter({ visible: true })
			.click();
		await windowTitled(adminPage, "Edit User");
		const other = adminPage.getByRole("dialog");
		await other.locator("[data-account-tab=profile][aria-selected=true]").waitFor();
		await adminPage.waitForFunction(() => document.activeElement?.getAttribute("name") === "name");
		await other.getByRole("switch", { name: "Administrator", exact: true }).waitFor();
		await other.getByRole("switch", { name: "Disabled", exact: true }).waitFor();
		const ownParts = other.locator(
			"[data-account-tab=password], [data-account-tab=mfa], [data-account-tab=api-tokens]",
		);
		if ((await ownParts.count()) > 0) throw new Error("another user's window offers the own parts");
		await other.locator("[data-account-tab=sign-in]").click();
		await other.locator("[data-sign-in-action=set-password]").waitFor();
		const shown = await other
			.locator("[data-sign-in-action]")
			.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-sign-in-action")));
		if (shown.join() !== "set-password,revoke-sessions")
			throw new Error(`the Sign-in part shows ${shown.join()} for a user without MFA or an OIDC link`);
		await other.locator("[data-sign-in-action=revoke-sessions]").click();
		const confirm = adminPage.getByRole("alertdialog");
		await confirm.getByRole("heading", { name: "Revoke sessions" }).waitFor();
		await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
		await confirm.waitFor({ state: "detached" });
		await adminPage.waitForFunction(
			() => document.activeElement?.getAttribute("data-sign-in-action") === "revoke-sessions",
		);
		// the frame is still open, and closes without a question (nothing was edited)
		await adminPage.keyboard.press("Escape");
		await windowClosed(adminPage);
		// Edit on the own row opens the own Account window: the own parts, never the switches or Sign-in
		const me = await admin.api("GET", "/users/me");
		await adminPage
			.getByRole("button", { name: `Edit ${me.name}`, exact: true })
			.filter({ visible: true })
			.click();
		await windowTitled(adminPage, "Account");
		const own = adminPage.getByRole("dialog");
		await own.locator("[data-account-tab=profile][aria-selected=true]").waitFor();
		const ownTabs = await own
			.locator("[data-account-tab]")
			.evaluateAll((tab) => tab.map((t) => t.dataset.accountTab));
		if (ownTabs.join() !== "profile,password,mfa,api-tokens")
			throw new Error(`the own Edit opened ${ownTabs.join()}`);
		if ((await own.getByRole("switch").count()) > 0)
			throw new Error("the own Edit offers the Administrator switch");
		await adminPage.keyboard.press("Escape");
		await windowClosed(adminPage);
		if (admin.errors.length > errorsBefore) throw new Error(`page error: ${admin.errors[errorsBefore]}`);

		// a phone: the entry opens its part on its heading, the back arrow shows the list, a row opens its part
		phone = await signIn(browser, base, VIEWER_EMAIL, viewerPassword, { width: 390, height: 844 });
		const small = phone.page;
		const sheet = await open(small, "password");
		await sheet.locator("[data-account-part=password]").waitFor();
		if (await sheet.getByRole("tablist").isVisible()) throw new Error("the side list shows on a phone");
		await small.waitForFunction(
			() =>
				document.activeElement?.matches("[data-account-part] h3") &&
				document.activeElement.textContent.trim() === "Password",
		);
		await sheet.locator("[data-account-back]").click();
		// F1: a long email must not widen the list; F7: the rows end in a chevron, the MFA row shows its state
		const overflow = await sheet
			.locator("[data-account-row]")
			.evaluateAll((list) => list.some((row) => row.getBoundingClientRect().right > window.innerWidth));
		if (overflow) throw new Error("a list row runs past the screen");
		await sheet.locator("[data-account-row=mfa] [data-slot=badge]").waitFor();
		await sheet.locator("[data-account-row=api-tokens]").click();
		await sheet.locator("[data-account-part=api-tokens]").waitFor();
		if ((await sheet.locator("[data-account-back]").count()) !== 1) throw new Error("no back arrow on a part");
		if (await small.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
			throw new Error("the phone window scrolls sideways");
		await small.keyboard.press("Escape");
		await windowClosed(small);
		if (phone.errors.length > 0) throw new Error(`page error on the phone: ${phone.errors[0]}`);
	} finally {
		await phone?.context.close();
		await viewer.context.close();
	}
}

const QR_NAME = /Scan this QR code/u;
const SECTIONS = ["Proxy Hosts", "Redirection Hosts", "404 Hosts", "Streams", "Access Lists", "Certificates"];
const LAST_USED_TIME = /\d{1,2}:\d{2}/u;

// the radio of one level in a section's segmented row
const levelRadio = (dialog, section, level) =>
	dialog.getByRole("radiogroup", { name: section, exact: true }).getByRole("radio", { name: level, exact: true });

// the part takes the focus on its heading on a phone (drill-in from the list), never on Revoke
async function titleHasFocus(page) {
	await page.waitForFunction(() => document.activeElement?.matches("[data-account-part] h3"));
	const text = await page.evaluate(() => document.activeElement.textContent.trim());
	if (text !== "API tokens") throw new Error(`the window opened with the focus on "${text}"`);
}

async function openApiTokens(page) {
	// leaving a page with a request in flight shows as a page error in WebKit
	// biome-ignore lint/suspicious/noPlaywrightNetworkidle: a request still in flight is aborted by the navigation
	await page.waitForLoadState("networkidle");
	await page.goto("/");
	await openAccount(page, "api-tokens");
	return page.getByRole("dialog");
}

// a token made in the window works for a script and stops at its revoke (shown once, never listed again)
async function apiTokens({ admin, base, browser, password }) {
	const { page } = admin;
	let script = null;
	let phone = null;
	// the sign-in page's own health check can end with an aborted request: only what this flow causes counts
	const errorsBefore = admin.errors.length;
	try {
		// the title takes the focus on a phone too
		phone = await signIn(browser, base, ADMIN_EMAIL, password, { width: 390, height: 844 });
		await openApiTokens(phone.page);
		await titleHasFocus(phone.page);
		if (phone.errors.length > 0) throw new Error(`page error on the phone: ${phone.errors[0]}`);
		await phone.context.close();
		phone = null;

		const dialog = await openApiTokens(page);
		await dialog.locator("[data-account-part=api-tokens]").waitFor();
		await dialog.getByRole("button", { name: "New token", exact: true }).click();
		const name = dialog.getByRole("textbox", { name: "Name", exact: true });
		// an empty Name that has the focus does not move the form: the first click on a Set all button is not lost
		await name.focus();
		await levelRadio(dialog, "Proxy Hosts", "View Only").and(page.locator(":enabled")).waitFor();
		await dialog.getByRole("button", { name: "Set every section to View Only", exact: true }).click();
		for (const section of SECTIONS) {
			// biome-ignore lint/performance/noAwaitInLoops: one check after the other
			await levelRadio(dialog, section, "View Only").and(page.locator("[aria-checked=true]")).waitFor();
		}
		// Create with the Name still empty: its error shows and the focus goes to it
		await dialog.getByRole("button", { name: "Create", exact: true }).click();
		await name.and(page.locator("[aria-invalid=true]")).waitFor();
		await page.waitForFunction(() => document.activeElement?.matches("[aria-invalid=true]"));
		if (!(await name.evaluate((input) => input === document.activeElement)))
			throw new Error("the focus is not in the empty Name after Create");
		await name.fill("flow-token");
		// Proxy Hosts: View Only (its dependencies turn on access lists and certificates at View Only)
		await levelRadio(dialog, "Proxy Hosts", "View Only").click();
		for (const section of ["Access Lists", "Certificates"]) {
			// biome-ignore lint/performance/noAwaitInLoops: one check after the other
			if ((await levelRadio(dialog, section, "View Only").getAttribute("aria-checked")) !== "true")
				throw new Error(`${section} did not turn on View Only`);
		}
		if (!(await levelRadio(dialog, "Access Lists", "Hidden").isDisabled()))
			throw new Error("Hidden is not disabled for Access Lists, which Proxy Hosts needs");
		// Set all: Hidden leaves every row Hidden; Proxy Hosts View Only again for the token
		await dialog.getByRole("button", { name: "Set every section to Hidden", exact: true }).click();
		for (const section of SECTIONS) {
			// biome-ignore lint/performance/noAwaitInLoops: one check after the other
			if ((await levelRadio(dialog, section, "Hidden").getAttribute("aria-checked")) !== "true")
				throw new Error(`${section} is not Hidden after Set all: Hidden`);
		}
		await levelRadio(dialog, "Proxy Hosts", "View Only").click();
		await dialog.getByRole("button", { name: "Create", exact: true }).click();
		const secret = (await dialog.locator("[data-api-token-secret]").textContent()).trim();
		if (!API_TOKEN.test(secret)) throw new Error("the window did not show a token");
		// the created step locks the window: the other parts are disabled and there is no X and no Close
		if (!(await dialog.locator("[data-account-tab=profile]").isDisabled()))
			throw new Error("the side list is not locked while the token shows");
		if ((await dialog.getByRole("button", { name: "Close", exact: true }).count()) > 0)
			throw new Error("the window can close while the token shows");
		// the secret is in the created step only: no storage, no address
		const kept = await page.evaluate(
			() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href,
		);
		if (kept.includes(secret)) throw new Error("the secret is in storage or in the address");
		script = await request.newContext({
			baseURL: base,
			ignoreHTTPSErrors: true,
			extraHTTPHeaders: { authorization: `Bearer ${secret}` },
		});
		if ((await script.get("/api/nginx/proxy-hosts")).status() !== 200)
			throw new Error("the token could not list proxy hosts");
		if ((await script.post("/api/nginx/proxy-hosts", { data: TOKEN_HOST })).status() !== 403)
			throw new Error("a view token could create");
		// a refused clipboard: the command shows in a box, with the token, and nothing says it was copied
		await page.evaluate(() => {
			navigator.clipboard.writeText = () => Promise.reject(new Error("refused"));
		});
		await dialog.getByRole("button", { name: "Copy the Claude Code command", exact: true }).click();
		const command = dialog.locator("[data-api-token-command]");
		await command.waitFor();
		const commandText = await command.textContent();
		if (!(commandText.includes("claude mcp add") && commandText.includes(secret)))
			throw new Error("the manual command lacks claude mcp add or the token");
		if ((await page.locator("[data-sonner-toast]").filter({ hasText: "copied" }).count()) > 0)
			throw new Error("a copied toast shows although the clipboard refused");
		await dialog.getByRole("button", { name: "Done", exact: true }).click();
		// the list shows the token without its secret, and the script's request as the time of its last use
		await dialog.getByText("flow-token", { exact: true }).waitFor();
		if ((await dialog.getByText(secret).count()) > 0) throw new Error("the list shows the secret");
		// a reload while a request is in flight shows as a page error in WebKit
		// biome-ignore lint/suspicious/noPlaywrightNetworkidle: a request still in flight is aborted by the reload
		await page.waitForLoadState("networkidle");
		await page.reload();
		await openApiTokens(page);
		await dialog.locator("li").filter({ hasText: "flow-token" }).filter({ hasText: LAST_USED_TIME }).waitFor();
		await dialog.getByRole("button", { name: "Revoke flow-token", exact: true }).click();
		await dialog.getByRole("button", { name: "Revoke", exact: true }).click();
		await dialog.getByText("flow-token", { exact: true }).waitFor({ state: "detached" });
		if ((await script.get("/api/nginx/proxy-hosts")).status() !== 401)
			throw new Error("the revoked token still works");
		await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
		await windowClosed(page);
		if (admin.errors.length > errorsBefore) throw new Error(`page error: ${admin.errors[errorsBefore]}`);
	} finally {
		await script?.dispose();
		await phone?.context.close();
		await cleanUp(admin.api);
	}
}

// a token never goes above its owner: the viewer (every section View Only, visibility all) has no Manage and no
// Administrator switch, "Set all: Manage" gives View Only and the arrow keys skip the disabled Manage
async function apiTokenCaps({ browser, base, viewerPassword }) {
	const viewer = await signIn(browser, base, VIEWER_EMAIL, viewerPassword);
	try {
		const { page } = viewer;
		const dialog = await openApiTokens(page);
		await dialog.getByRole("button", { name: "New token", exact: true }).click();
		// a name, so the token could be created
		await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("flow-caps");
		for (const section of SECTIONS) {
			// biome-ignore lint/performance/noAwaitInLoops: one check after the other
			if (!(await levelRadio(dialog, section, "Manage").isDisabled()))
				throw new Error(`${section} offers Manage`);
		}
		if ((await dialog.getByText("Administrator", { exact: true }).count()) > 0)
			throw new Error("a user offers the Administrator switch");
		// the owner's levels load after the window opens: until then every Manage is disabled and so is every View Only
		await levelRadio(dialog, "Proxy Hosts", "View Only").and(page.locator(":enabled")).waitFor();
		await dialog.getByRole("button", { name: "Set every section to Manage", exact: true }).click();
		for (const section of SECTIONS) {
			// biome-ignore lint/performance/noAwaitInLoops: one check after the other
			await levelRadio(dialog, section, "View Only").and(page.locator("[aria-checked=true]")).waitFor();
		}
		const proxyView = levelRadio(dialog, "Proxy Hosts", "View Only");
		await proxyView.focus();
		await page.keyboard.press("ArrowLeft");
		// the arrow skips the disabled Manage and wraps to Hidden (Chromium moves only the focus, WebKit also checks it)
		if ((await levelRadio(dialog, "Proxy Hosts", "Manage").getAttribute("aria-checked")) === "true")
			throw new Error("an arrow key chose the disabled Manage");
		const onManage = await page.evaluate(() => {
			const active = document.activeElement;
			return active?.getAttribute("role") === "radio" && active.textContent.trim() === "Manage";
		});
		if (onManage) throw new Error("the focus landed on the disabled Manage");
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
		await windowClosed(page);
		if (viewer.errors.length > 0) throw new Error(`page error for the viewer: ${viewer.errors[0]}`);
	} finally {
		await viewer.context.close();
	}
}

// Settings, API access: the code boxes sit inside their cards with their copy button inside, the client tabs switch
// the configuration, a token row names its marks and sections, and a phone shows the row as a card without sideways
// scrolling
async function apiAccess({ admin, browser, base, password }) {
	const { page } = admin;
	let phone = null;
	const errorsBefore = admin.errors.length;
	try {
		await admin.api("POST", "/users/me/api-tokens", {
			name: "flow-access",
			permissions: {
				proxy_hosts: "manage",
				redirection_hosts: "hidden",
				dead_hosts: "hidden",
				streams: "hidden",
				access_lists: "view",
				certificates: "view",
			},
			allow_delete: true,
		});
		await page.goto("/settings/api-access");
		await page.locator("[data-mcp-clients] [data-code-box]").first().waitFor();
		const boxes = await page.locator("[data-code-box]").evaluateAll((list) =>
			list
				.filter((box) => box.getClientRects().length > 0)
				.map((box) => {
					const card = box.closest("[role=group]").getBoundingClientRect();
					const wrap = box.getBoundingClientRect();
					const outer = box.parentElement.getBoundingClientRect();
					const copy = box.parentElement.querySelector("button").getBoundingClientRect();
					return {
						inset: outer.x - card.x,
						copyInside:
							copy.x >= outer.x &&
							copy.right <= outer.right &&
							copy.y >= outer.y &&
							copy.bottom <= outer.bottom,
						wrapInside: wrap.x >= outer.x && wrap.right <= outer.right,
					};
				}),
		);
		if (boxes.length === 0) throw new Error("no code box is visible");
		for (const box of boxes) {
			if (box.inset < 12) throw new Error(`a code box sits ${box.inset} px from its card`);
			if (!(box.copyInside && box.wrapInside)) throw new Error("a copy button or text lies outside its code box");
		}
		const clients = page.locator("[data-mcp-clients]");
		await clients.getByRole("tab", { name: "Claude Desktop and other clients", exact: true }).click();
		if (!(await clients.locator("[data-code-box]:visible").textContent()).includes('"mcpServers"'))
			throw new Error("the other clients tab does not show the mcpServers configuration");
		await page.keyboard.press("ArrowLeft");
		await clients.getByRole("tab", { name: "Claude Code", exact: true, selected: true }).waitFor();
		if (!(await clients.locator("[data-code-box]:visible").textContent()).trim().startsWith("claude mcp add"))
			throw new Error("the Claude Code box does not start with claude mcp add");
		// the row: Allow delete under the name, in the name's cell; the summary line, and in the Permissions popover
		// Proxy Hosts with Manage
		const row = rowOf(page, "flow-access").first();
		await row.waitFor();
		await row.getByText("Allow delete", { exact: true }).filter({ visible: true }).waitFor();
		await row
			.locator("[data-token-summary]")
			.filter({ hasText: "Manage 1 \u00b7 View 2 \u00b7 3 hidden" })
			.filter({ visible: true })
			.first()
			.waitFor();
		const opener = row
			.getByRole("button", { name: "Permissions of flow-access", exact: true })
			.filter({ visible: true })
			.first();
		await opener.click();
		const perms = page.locator("[data-token-permissions-list]").filter({ visible: true });
		await perms.locator("li").filter({ hasText: "Proxy Hosts" }).filter({ hasText: "Manage" }).waitFor();
		await perms.locator("li").filter({ hasText: "Redirection Hosts" }).filter({ hasText: "Hidden" }).waitFor();
		if (!(await perms.textContent()).includes("Allow deleteEnabled"))
			throw new Error("the popover does not show Allow delete as Enabled");
		await page.keyboard.press("Escape");
		await perms.waitFor({ state: "hidden" });
		await page.waitForFunction(
			() => document.activeElement?.getAttribute("aria-label") === "Permissions of flow-access",
		);
		const placed = await row.evaluate((tr) => {
			// the cell holds a copy for a narrow table and one for a wide one: take the shown ones
			const cell = tr.querySelector("td");
			const shown = [...cell.querySelectorAll("*")].filter((el) => el.getClientRects().length > 0);
			const name = shown.find((el) => el.tagName === "SPAN" && el.textContent === "flow-access");
			const badge = shown.find((el) => el.children.length === 0 && el.textContent.trim() === "Allow delete");
			if (!(name && badge)) return null;
			return { gap: badge.getBoundingClientRect().top - name.getBoundingClientRect().bottom };
		});
		if (!placed) throw new Error("the Allow delete badge is not in the name's cell");
		if (placed.gap < 0) throw new Error("the Allow delete badge is not below the token name");
		if (admin.errors.length > errorsBefore) throw new Error(`page error: ${admin.errors[errorsBefore]}`);

		// a phone: no sideways scroll, the row is a card with its Revoke button
		phone = await signIn(browser, base, ADMIN_EMAIL, password, { width: 390, height: 844 });
		await phone.page.goto("/settings/api-access");
		const card = rowOf(phone.page, "flow-access");
		await card.first().waitFor();
		await card
			.getByRole("button", { name: "Revoke flow-access", exact: true })
			.filter({ visible: true })
			.first()
			.waitFor();
		const wide = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
		if (wide > 0) throw new Error(`the page scrolls sideways on a phone by ${wide} px`);
		if (phone.errors.length > 0) throw new Error(`page error on the phone: ${phone.errors[0]}`);
	} finally {
		await phone?.context.close();
		await cleanUp(admin.api);
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
	await inviteOption(admin);
}

// The invite option of the new user window follows what the backend offers: mail configured, Invitations on, a valid
// public URL and password sign-in on. The smoke test has no PUBLIC_URL, so there the option is absent (logged); an
// instance with all of them shows it. The flow reads the stored settings and asserts the matching state, and creates
// nothing.
async function inviteOption({ page, api }) {
	const email = await api("GET", "/settings/email");
	const notifications = await api("GET", "/settings/notifications");
	const health = await api("GET", "");
	const publicUrl = String(notifications.public_url ?? "").startsWith("https://");
	const offered = email.configured === true && email.invitations === true && publicUrl && health.password === true;
	await page.goto("/settings/users");
	await page.getByRole("button", { name: "Add User", exact: true }).filter({ visible: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.locator('input[name="email"]').waitFor();
	const shown = (await dialog.locator("#invite").count()) > 0;
	if (shown !== offered)
		throw new Error(
			`the invite option is ${shown ? "shown" : "absent"} but invitations are ${offered ? "" : "not "}offered (mail ${email.configured}, switch ${email.invitations}, public URL ${publicUrl}, password sign-in ${health.password})`,
		);
	console.log(
		offered
			? "users: the invite option is shown (mail configured, Invitations on, public URL set)"
			: `users: the invite option is absent (${publicUrl ? "mail, the Invitations switch or password sign-in is off" : "no public URL"})`,
	);
	await page.keyboard.press("Escape");
	await windowClosed(page);
}

// A window opened with the mouse focuses its first element, and closing it gives the focus back to the button that
// opened it; neither is keyboard focus, so no tooltip may open by itself (the avatar's and the eye button's did).
async function windowFocusTooltip({ admin }) {
	const { page } = admin;
	// a tooltip that opens by itself does so within its delay: give it 700 ms to appear
	const noTooltip = async (where) => {
		const opened = await page
			.locator("[data-slot=tooltip-content]")
			.first()
			.waitFor({ state: "attached", timeout: 700 })
			.then(
				() => true,
				() => false,
			);
		if (opened) throw new Error(`a tooltip opened by itself ${where}`);
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
	await windowTitled(page, "Edit User");
	await noTooltip("when the user window opened");
	await page.keyboard.press("Escape");
	await windowClosed(page);
	// the Account window opened from the menu on Profile: the avatar there must not open a tooltip
	await page.goto("/");
	await openAccount(page);
	await noTooltip("when the Account window opened");
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

// Two proxy hosts with tags: a tag badge filters the list, a second tag narrows it, Clear filters shows both; the
// window suggests a tag already used
async function tagFilter({ admin }) {
	const { page, api } = admin;
	const made = [];
	try {
		const host = (domain, tags) =>
			api("POST", "/nginx/proxy-hosts", {
				domain_names: [domain],
				forward_scheme: "http",
				forward_host: "127.0.0.1",
				forward_port: 8080,
				npmpro_tags: tags,
			});
		made.push(await host("flow-tag1.example.com", ["flow-a", "flow-b"]));
		made.push(await host("flow-tag2.example.com", ["flow-a"]));
		await page.goto("/nginx/proxy");
		await page.getByRole("textbox", { name: "Search", exact: true }).fill("flow-tag");
		await rowOf(page, "flow-tag2.example.com").first().waitFor();
		await rowOf(page, "flow-tag1.example.com")
			.getByRole("button", { name: "Show only hosts tagged flow-b", exact: true })
			.filter({ visible: true })
			.first()
			.click();
		await page.waitForURL(TAG_B_URL);
		await rowOf(page, "flow-tag2.example.com").first().waitFor({ state: "detached" });
		await rowOf(page, "flow-tag1.example.com").first().waitFor();
		await page.getByRole("button", { name: TAGS_BUTTON }).click();
		await page.getByRole("menuitemcheckbox", { name: "flow-a", exact: true }).click();
		await page.keyboard.press("Escape");
		await page.waitForURL(BOTH_TAGS_URL);
		await rowOf(page, "flow-tag1.example.com").first().waitFor();
		await page.getByRole("button", { name: "Clear filters", exact: true }).click();
		await page.waitForURL((url) => !url.searchParams.has("tag"));
		// a search typed before the router has settled would be merged into the old address, so wait for the cleared bar
		await page.getByRole("button", { name: "Clear filters", exact: true }).waitFor({ state: "detached" });
		// Clear filters also empties the search: search again so both rows are on the first page
		await page.getByRole("textbox", { name: "Search", exact: true }).fill("flow-tag");
		await rowOf(page, "flow-tag2.example.com").first().waitFor();
		// the window suggests the tags in use
		await page.getByRole("button", { name: "Add Proxy Host", exact: true }).first().click();
		const dialog = page.getByRole("dialog");
		await dialog.locator("#npmproTags").fill("flow-");
		await page.getByRole("option", { name: "flow-a", exact: true }).waitFor();
		await page.keyboard.press("Escape");
		await dialog.getByRole("button", { name: "Close", exact: true }).click();
		const ask = page.getByRole("alertdialog");
		if ((await ask.count()) > 0) await ask.getByRole("button", { name: "Discard changes", exact: true }).click();
		await windowClosed(page);
	} finally {
		for (const row of made) {
			// biome-ignore lint/performance/noAwaitInLoops: one delete after another
			await api("DELETE", `/nginx/proxy-hosts/${row.id}`).catch(() => undefined);
		}
	}
}

const API_REFERENCE_URL = /\/api-reference#proxy-hosts\/get-nginx-proxy-hosts$/u;
const GET_PROXY_HOSTS = "proxy-hosts/get-nginx-proxy-hosts";
const FAKE_TOKEN = `npmpro_0000000000000000_${"A".repeat(43)}`;
// an operation that starts with its method badge (a text search for DELETE also finds a POST whose text says delete)
const DELETE_OPERATION = /^DELETE/u;
const apiOperation = (page, anchor) => page.locator(`[data-api-op][id="${anchor}"]`);
// every request the page sends to the API from now on
const apiRequests = (page) => {
	const seen = [];
	page.on("request", (sent) => {
		if (sent.url().includes("/api/")) seen.push(`${sent.method()} ${sent.url()}`);
	});
	return seen;
};
const tryOpenAndSend = async (operation) => {
	await operation.locator("[data-try-open]").click();
	await operation.locator("[data-try-send]").click();
	return operation.locator("[data-try-result]");
};
const inViewport = (anchor) => {
	const box = document.querySelector(`[id="${anchor}"]`)?.getBoundingClientRect();
	return box !== undefined && box.top < window.innerHeight && box.bottom > 0;
};

async function apiReference({ admin, base }) {
	const { page } = admin;
	await page.setViewportSize({ width: 1440, height: 900 });
	// an old Swagger link lands on its route
	await page.goto(`${base}/api/docs/#/Proxy%20Hosts/getProxyHosts`);
	await page.waitForURL(API_REFERENCE_URL);
	const operation = apiOperation(page, GET_PROXY_HOSTS);
	await operation.waitFor();
	await page.waitForFunction(inViewport, GET_PROXY_HOSTS);
	await page.locator(`a[href="#${GET_PROXY_HOSTS}"][aria-current]`).waitFor();

	// the search keeps the routes that match, Escape clears it
	const search = page.getByRole("searchbox", { name: "Search routes", exact: true }).first();
	await search.fill("proxy");
	await page.locator("[data-api-op]").first().waitFor();
	const heads = await page
		.locator("[data-api-op]")
		.evaluateAll((els) =>
			els.map(
				(el) => `${el.querySelector(":scope > div > div")?.textContent} ${el.querySelector("h3")?.textContent}`,
			),
		);
	if (heads.length === 0) throw new Error("the search shows no route");
	const stray = heads.find((head) => !head.toLowerCase().includes("proxy"));
	if (stray !== undefined) throw new Error(`the search shows a route without the word: ${stray}`);
	await search.press("Escape");
	if ((await search.inputValue()) !== "") throw new Error("Escape did not clear the search");
	await operation.waitFor();

	// the code tabs
	for (const [tab, text] of [
		["curl", "curl"],
		["Node", "fetch("],
		["Python", "requests."],
	]) {
		// biome-ignore lint/performance/noAwaitInLoops: one tab after another
		await operation.getByRole("tab", { name: tab, exact: true }).click();
		const shown = operation.locator(`[data-code-tab=${tab.toLowerCase()}]`);
		await shown.waitFor();
		if (!(await shown.textContent()).includes(text)) throw new Error(`the ${tab} tab does not show ${text}`);
	}
	await operation.getByRole("tab", { name: "curl", exact: true }).click();

	// Try it as the session
	await operation.scrollIntoViewIfNeeded();
	const result = await tryOpenAndSend(operation);
	await result.waitFor();
	if (!(await result.textContent()).includes("200")) throw new Error(`Try it shows ${await result.textContent()}`);
	await operation.locator("[data-try-cancel]").click();

	// on a DELETE, opening Try it and the first Send click send nothing: the first click asks for a confirmation
	const seen = apiRequests(page);
	const del = page.locator("[data-api-op]").filter({ hasText: DELETE_OPERATION }).first();
	await del.scrollIntoViewIfNeeded();
	await del.locator("[data-try-open]").click();
	await del.locator("[data-try-panel]").waitFor();
	const send = del.locator("[data-try-send]");
	await send.click();
	await del.getByRole("alert").filter({ hasText: "This changes data on this instance." }).waitFor();
	if ((await send.textContent()).trim() !== "Send DELETE")
		throw new Error(`the confirm button reads ${await send.textContent()}`);
	if (seen.length > 0) throw new Error(`the first Send click sent ${seen.join(", ")}`);
	await del.locator("[data-try-cancel]").click();
	await del.locator("[data-try-panel]").waitFor({ state: "detached" });
	if (seen.length > 0) throw new Error(`opening and cancelling sent ${seen.join(", ")}`);

	// a pasted token: Try it runs as that token, and nothing keeps it
	await page.locator("[data-token-open]").click();
	const tokenField = page.locator("#api-reference-token");
	await tokenField.fill(FAKE_TOKEN);
	// no form around the field, so password managers do not take it for a sign-in; Enter applies it
	if ((await tokenField.evaluate((el) => el.closest("form") !== null)) === true)
		throw new Error("the token field is inside a form");
	await tokenField.press("Enter");
	await page.locator("[data-token-popover]").waitFor({ state: "detached" });
	await operation.scrollIntoViewIfNeeded();
	const asToken = await tryOpenAndSend(operation);
	await asToken.waitFor();
	if (!(await asToken.textContent()).includes("401"))
		throw new Error(`the token shows ${await asToken.textContent()}`);
	const kept = await page.evaluate(() =>
		[JSON.stringify(localStorage), JSON.stringify(sessionStorage), location.href].some((v) =>
			v.includes("npmpro_0000"),
		),
	);
	if (kept) throw new Error("the token is kept in the page storage or the address");
	if (!(await operation.locator("[data-code-tab=curl]").textContent()).includes("$NPMPRO_TOKEN"))
		throw new Error("the curl text lost $NPMPRO_TOKEN");
	await page.reload();
	await page.locator("[data-api-op]").first().waitFor();
	if (!((await page.locator("[data-token-open]").getAttribute("aria-label")) ?? "").includes("Use a token"))
		throw new Error("the token is still set after a reload");
	if (admin.errors.length > 0) throw new Error(`page error: ${admin.errors[0]}`);
}

const ACME_CARD = "[data-acme-card]";
const ACME_STATES = ["none", "pending", "failed", "registered"];
const ACME_URL_A = "https://127.0.0.1/acme/directory";
const ACME_URL_B = "https://127.0.0.1/acme/other";
const UNSAVED_QUESTION = { name: "Unsaved changes" };

/**
 * The ACME account card of Settings, Certificates: its state, the Connect window (a locked email, the refused custom
 * URL with nothing saved, the unsaved-changes question on Escape), the profile field and (on an instance with a
 * registered account) the Replace window from its button.
 */
const RESOLVER_ADDRESSES = "#runtime-resolverAddresses";
const RESOLVER_SWITCH = "#runtime-resolverHosts";
const UNKNOWN_RESOLVER = "dns.example";

// The DNS resolver card of Settings, nginx: it shows, the hosts switch is read-only when its env var is set, and a
// name typed as an address (not yet a chip) enables Save, the save is refused with its message and sends no request,
// and leaving the page with the typed text asks first. No resolver address is saved: a save reloads nginx with it.
async function dnsResolver({ admin }) {
	const { page, api, errors } = admin;
	const before = JSON.stringify(await api("GET", "/settings/runtime/nginx"));
	const changes = [];
	page.on("request", (sent) => {
		if (sent.method() !== "GET") changes.push(`${sent.method()} ${sent.url()}`);
	});
	await page.goto("/settings/nginx");
	await page.getByText("DNS resolver", { exact: true }).first().waitFor();
	const addresses = page.locator(RESOLVER_ADDRESSES);
	await addresses.waitFor();
	const hosts = page.locator(RESOLVER_SWITCH);
	await hosts.waitFor();
	if (await hosts.isDisabled()) {
		await page
			.locator("[data-setting-line]")
			.filter({ has: hosts })
			.getByText("Set by environment")
			.first()
			.waitFor();
	} else {
		console.log("  (the hosts switch is not locked here)");
	}
	// typed text not yet taken as a chip is something to save: Save is enabled and a save takes the text first
	await addresses.fill(UNKNOWN_RESOLVER);
	const save = page.locator("form").getByRole("button", { name: "Save", exact: true });
	if (await save.isDisabled()) throw new Error("Save stays disabled with a typed address");
	await save.click();
	await page.getByText(`${UNKNOWN_RESOLVER} is not an IP address`, { exact: false }).first().waitFor();
	// the typed text is still an unsaved change: leaving through the menu asks, Keep editing stays, Discard leaves
	const menuLink = page.locator('header nav a[href="/access"]').filter({ visible: true }).first();
	await menuLink.click();
	const ask = page.getByRole("alertdialog");
	await ask.getByRole("button", { name: "Keep editing", exact: true }).click();
	await ask.waitFor({ state: "detached" });
	if (!page.url().endsWith("/settings/nginx")) throw new Error("Keep editing left the page");
	if ((await addresses.inputValue()) !== UNKNOWN_RESOLVER) throw new Error("Keep editing lost the typed address");
	await menuLink.click();
	await ask.getByRole("button", { name: "Discard changes", exact: true }).click();
	await page.waitForURL("**/access");
	if (changes.length > 0) throw new Error(`a save request was sent: ${changes}`);
	if (JSON.stringify(await api("GET", "/settings/runtime/nginx")) !== before)
		throw new Error("the nginx settings changed");
	if (errors.length > 0) throw new Error(`page error: ${errors[0]}`);
}

async function acmeAccount({ admin }) {
	const { page, api } = admin;
	const before = await api("GET", "/settings/acme");
	const replaceRequests = [];
	page.on("request", (sent) => {
		if (sent.url().includes("/api/settings/acme/replace")) replaceRequests.push(sent.method());
	});
	await page.goto("/settings/certificates");
	const card = page.locator(ACME_CARD);
	await card.waitFor();
	const state = await card.locator("[data-acme-state]").first().getAttribute("data-acme-state");
	if (!ACME_STATES.includes(state)) throw new Error(`the card shows the state "${state}"`);
	console.log(`  acme account: state ${state}`);

	// 2. Change (or Connect) opens the window; a locked email shows read-only with the badge
	await card.locator("[data-acme-action=change], [data-acme-action=connect]").first().click();
	const connect = page.locator("[data-acme-connect]");
	await connect.waitFor();
	const emailLocked = (before.locked ?? []).includes("email");
	if (emailLocked) {
		await connect.getByText("Set by environment").first().waitFor();
		const email = connect.locator("#acme-email");
		if (!((await email.isDisabled()) || (await email.getAttribute("readonly")) !== null))
			throw new Error("the locked email can be edited");
		console.log("  acme account: email locked, checked the badge and the field");
	} else {
		console.log("  acme account: email not locked, lock check skipped");
	}

	// 3. a refused custom URL: the error stays in the window, nothing is saved
	await connect.locator("#acme-ca").click();
	await page.getByRole("option", { name: "Custom URL", exact: true }).click();
	await connect.locator("#acme-url").fill(ACME_URL_A);
	await connect.getByRole("button", { name: "Connect", exact: true }).click();
	await connect.locator("[data-acme-refused]").waitFor();
	await connect.getByText("This address is not allowed").first().waitFor();
	const after = await api("GET", "/settings/acme");
	if (after.server !== before.server) throw new Error(`the refused save changed the server to ${after.server}`);
	if (JSON.stringify(after.accounts) !== JSON.stringify(before.accounts))
		throw new Error("the refused save changed the accounts");

	// 4. another custom URL, then Escape: the question, Keep editing stays, Discard changes closes the window
	await connect.locator("#acme-url").fill(ACME_URL_B);
	await page.keyboard.press("Escape");
	await page.getByRole("heading", UNSAVED_QUESTION).waitFor();
	await page.getByRole("button", { name: "Keep editing", exact: true }).click();
	await page.getByRole("heading", UNSAVED_QUESTION).waitFor({ state: "hidden" });
	if ((await connect.locator("#acme-url").inputValue()) !== ACME_URL_B) throw new Error("Keep editing lost the URL");
	await page.keyboard.press("Escape");
	await page.getByRole("heading", UNSAVED_QUESTION).waitFor();
	await page.getByRole("button", { name: "Discard changes", exact: true }).click();
	await windowClosed(page);
	const kept = await api("GET", "/settings/acme");
	if (kept.server !== before.server || JSON.stringify(kept.accounts) !== JSON.stringify(before.accounts))
		throw new Error("discarding changed the stored settings");

	// 5. the profile field of the request card: a select or the text field
	const profile = page.locator("#runtime-profile");
	await profile.waitFor();
	if ((await profile.evaluate((el) => el.tagName)) === "INPUT") {
		console.log("  acme account: profile is a text field");
	} else {
		await profile.click();
		await page.getByRole("option", { name: "Server default", exact: true }).first().waitFor();
		await page.keyboard.press("Escape");
		await page.getByRole("option", { name: "Server default", exact: true }).first().waitFor({ state: "hidden" });
		console.log("  acme account: profile is a select");
	}

	// 6. the Replace window of a registered account: opens filled, Cancel sends nothing
	const account = (before.accounts ?? []).find((entry) => entry.server === before.server);
	if (account?.state === "registered") {
		await page.goto("/settings/certificates");
		await card.locator("[data-acme-action=replace]").first().click();
		const replace = page.locator("[data-acme-replace]");
		await replace.waitFor();
		const expected = emailLocked ? before.email : (account.email ?? "");
		if ((await replace.locator("#acme-replace-email").inputValue()) !== expected)
			throw new Error("the Replace window does not show the account email");
		if (await page.evaluate(switchOn, "#acme-replace-deactivate")) throw new Error("the deactivate switch is on");
		await replace.getByRole("button", { name: "Cancel", exact: true }).click();
		await windowClosed(page);
		const same = await api("GET", "/settings/acme");
		if (JSON.stringify(same.accounts) !== JSON.stringify(before.accounts))
			throw new Error("Cancel changed the account");
		if (replaceRequests.length > 0) throw new Error(`Cancel sent ${replaceRequests.length} replace request(s)`);
	} else {
		console.log("  acme account: no registered account, Replace step not run");
	}

	// 7. the Other CAs list: the empty line on an instance without another CA, else a row per CA; Add a CA refuses a
	// blocked URL in the window and stores nothing
	await page.goto("/settings/certificates");
	const others = card.locator("[data-acme-others]");
	await others.waitFor();
	const otherRows = (before.accounts ?? []).filter((entry) => entry.server !== before.server).length;
	if (otherRows === 0) {
		await others.locator("[data-acme-others-empty]").waitFor();
		console.log("  acme account: no other CA, the empty line shows");
	} else if ((await others.locator("[data-acme-other]").count()) !== otherRows) {
		throw new Error("the Other CAs list does not show a row per stored account");
	}
	await others.locator("[data-acme-action=add]").click();
	await connect.waitFor();
	await connect.getByText("Add a certificate authority").first().waitFor();
	await connect.locator("#acme-ca").click();
	await page.getByRole("option", { name: "Custom URL", exact: true }).click();
	await connect.locator("#acme-url").fill(ACME_URL_A);
	await connect.getByRole("button", { name: "Connect", exact: true }).click();
	await connect.locator("[data-acme-refused]").waitFor();
	await connect.getByText("This address is not allowed").first().waitFor();
	await connect.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.getByRole("button", { name: "Discard changes", exact: true }).click();
	await windowClosed(page);
	const added = await api("GET", "/settings/acme");
	if (JSON.stringify(added.accounts) !== JSON.stringify(before.accounts))
		throw new Error("the refused Add a CA stored an account");

	// 8. Remove on another CA's row asks first; Cancel keeps the account (the real removal is a live check)
	if (otherRows > 0) {
		await others.locator("[data-acme-other] [data-acme-action=remove]").first().click();
		await page.getByRole("alertdialog").getByText("The account stays at the CA").waitFor();
		await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
		await windowClosed(page);
		const afterCancel = await api("GET", "/settings/acme");
		if (JSON.stringify(afterCancel.accounts) !== JSON.stringify(before.accounts))
			throw new Error("Cancel in the Remove question changed the accounts");
	}
	if (admin.errors.length > 0) throw new Error(`page error: ${admin.errors[0]}`);
}

const DBIP_RADIO = /^DB-IP Lite/u;
const MAXMIND_RADIO = /^MaxMind GeoLite2/u;
const DBIP_CREDIT = "IP Geolocation by DB-IP";
const MAXMIND_CREDIT = "This product includes GeoLite Data created by MaxMind";

// Settings, GeoIP: the provider choice. Where an env var locks the provider (the smoke test sets GEOIP_PROVIDER) the
// Provider line shows the lock and MaxMind chosen and disabled, the Account card and the MaxMind credit show. Without
// the lock the choice switches the cards (DB-IP: no Account card, the DB-IP Databases with Country and ASN on, its
// credit; MaxMind: the Account card again) and the page is left without a save, which would start a download.
async function geoipProvider({ admin }) {
	const { page, api, errors } = admin;
	const before = JSON.stringify(await api("GET", "/settings/geoip"));
	const settings = JSON.parse(before);
	const changes = [];
	page.on("request", (sent) => {
		if (sent.method() !== "GET") changes.push(`${sent.method()} ${sent.url()}`);
	});
	await page.goto("/settings/geoip");
	const dbip = page.getByRole("radio", { name: DBIP_RADIO });
	const maxmind = page.getByRole("radio", { name: MAXMIND_RADIO });
	const account = page.getByText("MaxMind account", { exact: true });
	const dbipDatabases = page.getByRole("switch", { name: "Country", exact: true });
	await maxmind.waitFor();
	if (settings.locked?.includes("provider")) {
		await page.getByText("Set by environment").first().waitFor();
		if (settings.provider !== "maxmind") throw new Error(`the locked provider is ${settings.provider}`);
		if (!(await maxmind.isChecked())) throw new Error("the locked provider is not shown as chosen");
		if (await maxmind.isEnabled()) throw new Error("the locked provider choice is not disabled");
		await account.waitFor();
		await page.getByText(MAXMIND_CREDIT, { exact: false }).waitFor();
		console.log("  (the provider is locked by env)");
	} else {
		await dbip.check();
		await account.waitFor({ state: "detached" });
		await dbipDatabases.waitFor();
		await page.getByRole("switch", { name: "ASN", exact: true }).waitFor();
		await page.getByText(DBIP_CREDIT, { exact: true }).waitFor();
		await maxmind.check();
		await account.waitFor();
		await dbipDatabases.waitFor({ state: "detached" });
		// leaving asks when the form differs from the saved provider; Discard changes leaves without a save
		const menuLink = page.locator('header nav a[href="/access"]').filter({ visible: true }).first();
		await menuLink.click();
		const ask = page.getByRole("alertdialog");
		await Promise.race([page.waitForURL("**/access"), ask.waitFor()]);
		if ((await ask.count()) > 0) {
			await ask.getByRole("button", { name: "Discard changes", exact: true }).click();
			await page.waitForURL("**/access");
		}
	}
	if (changes.length > 0) throw new Error(`a save request was sent: ${changes}`);
	if (JSON.stringify(await api("GET", "/settings/geoip")) !== before) throw new Error("the GeoIP settings changed");
	if (errors.length > 0) throw new Error(`page error: ${errors[0]}`);
}

export const appFlows = [
	{ name: "api reference", run: apiReference },
	{ name: "settings save", run: settingsSave },
	{ name: "warning days", run: warningDaysSave },
	{ name: "dns resolver", run: dnsResolver },
	{ name: "acme account", run: acmeAccount },
	{ name: "log format", run: logFormat },
	{ name: "tls handshake log", run: tlsHandshakeLog },
	{ name: "crowdsec settings", run: crowdsecSettings },
	{ name: "geoip provider", run: geoipProvider },
	{ name: "collapsed card opens", run: collapsedCardOpens },
	{ name: "landing pages settings", run: landingPagesSettings },
	{ name: "phone list", run: phoneList },
	{ name: "mfa window", run: mfaWindow },
	{ name: "account window", run: accountWindow },
	{ name: "api tokens", run: apiTokens },
	{ name: "api token caps", run: apiTokenCaps },
	{ name: "api access", run: apiAccess },
	{ name: "users sign-in", run: usersSignIn },
	{ name: "window focus tooltip", run: windowFocusTooltip },
	{ name: "help sheet", run: helpSheet },
	{ name: "list paging", run: listPaging },
	{ name: "tag filter", run: tagFilter },
	{ name: "language fallback", run: languageFallback },
	{ name: "language", run: languageSwitch },
];
