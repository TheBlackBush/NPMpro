// A settings save with its toast, the CrowdSec section, a refused save that opens a collapsed card, the Landing pages
// section (with the visit time choices), the phone layout of a host list, the MFA and help windows, and the language switch (last: it reloads the
// page).
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
const TAG_B_URL = /[?&]tag=flow-b(?:&|$)/u;
const TAGS_BUTTON = /^Tags: /u;
const BOTH_TAGS_URL = /tag=flow-b&tag=flow-a/u;
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
// Tokyo (UTC+9, no summer time), shows that choice's text. The expected local text comes from the same browser's Intl
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

export const appFlows = [
	{ name: "settings save", run: settingsSave },
	{ name: "log format", run: logFormat },
	{ name: "tls handshake log", run: tlsHandshakeLog },
	{ name: "crowdsec settings", run: crowdsecSettings },
	{ name: "collapsed card opens", run: collapsedCardOpens },
	{ name: "landing pages settings", run: landingPagesSettings },
	{ name: "phone list", run: phoneList },
	{ name: "mfa window", run: mfaWindow },
	{ name: "users sign-in", run: usersSignIn },
	{ name: "window focus tooltip", run: windowFocusTooltip },
	{ name: "help sheet", run: helpSheet },
	{ name: "list paging", run: listPaging },
	{ name: "tag filter", run: tagFilter },
	{ name: "language fallback", run: languageFallback },
	{ name: "language", run: languageSwitch },
];
