// Helpers of the browser flows (scripts/flows/run.js): sessions, API calls with a session's cookie, and waits on what
// the page shows. Every wait is on a state of the page, never on time.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

export const ADMIN_EMAIL = "admin@example.com";
export const VIEWER_EMAIL = "flow-viewer@example.com";

const CONTEXT = { ignoreHTTPSErrors: true, locale: "en-US", viewport: { width: 1440, height: 900 } };

function apiOf(context, base) {
	// body: JSON data, or { multipart } for an upload
	return async (method, path, body) => {
		const options = body?.multipart ? { method, multipart: body.multipart } : { method, data: body };
		const answer = await context.request.fetch(`${base}/api${path}`, options);
		const text = await answer.text();
		if (!answer.ok()) throw new Error(`${method} ${path}: ${answer.status()} ${text}`);
		return text ? JSON.parse(text) : null;
	};
}

/**
 * Signs in through the login page in a new browser context. errors collects the page errors of its page.
 *
 * @returns {Promise<{context: Object, page: Object, api: Function, errors: string[]}>}
 */
// biome-ignore lint/complexity/useMaxParams: the one entry point of every flow session
// waits until GET /api reports OK (at most 60 s), checking every half second
async function apiAnswers(context) {
	const until = Date.now() + 60_000;
	while (Date.now() < until) {
		// biome-ignore lint/performance/noAwaitInLoops: one check after the other
		const response = await context.request.get("/api/", { failOnStatusCode: false }).catch(() => null);
		if (response?.ok() && (await response.json().catch(() => ({}))).status === "OK") return;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error("the API did not answer OK within 60 seconds");
}

export async function signIn(browser, base, email, password, viewport = CONTEXT.viewport) {
	const context = await browser.newContext({ ...CONTEXT, viewport, baseURL: base });
	const page = await context.newPage();
	// a remote Chromium (FLOWS_CDP, local runs only) ignores the context's viewport and stays 800 x 600: set it by hand
	// biome-ignore lint/style/noProcessEnv: the same switch as in run.js
	if (process.env.FLOWS_CDP) {
		const session = await context.newCDPSession(page);
		await session.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
	}
	page.setDefaultTimeout(15_000);
	page.setDefaultNavigationTimeout(30_000);
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	// an earlier flow's save can reload nginx: open the page once the API answers (after two failed health checks the
	// app shows "unhealthy" and retries with a growing delay, which can outlast the default timeout)
	await apiAnswers(context);
	await page.goto("/");
	await page.locator("#login-email").waitFor({ timeout: 60_000 });
	await page.locator("#login-email").fill(email);
	await page.locator("#login-password").fill(password);
	await page.locator("form button[type=submit]").click();
	await page.locator("#login-email").waitFor({ state: "detached" });
	return { context, page, api: apiOf(context, base), errors };
}

// CSS, not roles: an open window hides the page from the accessibility tree, and some checks read the list behind it
export const rowOf = (page, text) => page.locator("tbody tr").filter({ hasText: text }).filter({ visible: true });

export async function rowShows(page, name, text) {
	await rowOf(page, name).filter({ hasText: text }).first().waitFor();
}

export async function rowGone(page, name) {
	await page.locator("tbody tr").filter({ hasText: name }).first().waitFor({ state: "detached" });
}

export async function rowAction(page, name, item) {
	await page
		.getByRole("button", { name: `Actions for ${name}`, exact: true })
		.filter({ visible: true })
		.click();
	await page.getByRole("menuitem", { name: item, exact: true }).click();
}

export async function windowClosed(page) {
	await page.waitForFunction(() => document.querySelector("[role=dialog]") === null);
}

export async function windowTitled(page, title) {
	await page.getByRole("dialog").getByRole("heading", { name: title, exact: true }).waitFor();
}

/** Runs action and waits for a toast with text that was not on the page before */
export async function withToast(page, text, action) {
	await page.locator("[data-sonner-toast]").evaluateAll((toasts) => {
		for (const toast of toasts) toast.setAttribute("data-flow-seen", "");
	});
	await action();
	await page.locator("[data-sonner-toast]:not([data-flow-seen])").filter({ hasText: text }).first().waitFor();
}

export async function addDomain(dialog, name) {
	const input = dialog.locator("#domainNames");
	await input.fill(name);
	await input.press("Enter");
	await dialog.locator("[data-slot=combobox-chips]").getByText(name, { exact: true }).waitFor();
}

export const openTab = (dialog, tab) => dialog.locator(`[role=tab][data-tab=${tab}]`).click();

/** Saves the open window and waits for its toast and for the window to go */
export async function saveWindow(page, object) {
	const save = page.getByRole("dialog").getByRole("button", { name: "Save", exact: true });
	await withToast(page, `${object} has been saved`, () => save.click());
	await windowClosed(page);
}

/**
 * Saves the open window like saveWindow and returns the JSON body the window sent (POST or PUT of the host's route)
 */
export async function saveWindowSent(page, object, apiPath) {
	const sent = page.waitForRequest(
		(request) => request.url().includes(`/api${apiPath}`) && ["POST", "PUT"].includes(request.method()),
	);
	await saveWindow(page, object);
	return (await sent).postDataJSON();
}

/** Throws unless every key of expected has exactly that value, of that type, in row (compared as JSON) */
export function assertFields(row, expected, what) {
	for (const [key, value] of Object.entries(expected)) {
		if (JSON.stringify(row[key]) !== JSON.stringify(value)) {
			throw new Error(`${what}: ${key} is ${JSON.stringify(row[key])}, expected ${JSON.stringify(value)}`);
		}
	}
}

/** Throws if row has any of the keys, null too (the fields of another host type: none is sent or returned today) */
export function assertAbsent(row, keys, what) {
	const found = keys.filter((key) => row[key] !== undefined);
	if (found.length > 0) throw new Error(`${what} holds fields of another host type: ${found.join(", ")}`);
}

// the controls that change data: every one of them must be disabled or read-only in a View window. The close buttons
// are the only enabled ones.
const ENABLED_CONTROLS = (root) =>
	[
		...root.querySelectorAll(
			"input, select, textarea, button, [role=switch], [role=combobox], [role=checkbox], [role=radio]",
		),
	]
		.filter(
			(el) =>
				el.type !== "hidden" &&
				el.getClientRects().length > 0 &&
				!el.closest("[role=tablist]") &&
				!(el.disabled || el.closest("fieldset:disabled") || el.readOnly) &&
				el.getAttribute("aria-readonly") !== "true" &&
				el.getAttribute("aria-disabled") !== "true" &&
				// what a View window keeps usable on purpose: the cards of the locations open and close, and the filter
				// above them works; their fields are checked with the cards open
				!(el.hasAttribute("aria-expanded") && el.getAttribute("role") !== "combobox") &&
				!el
					.closest("[data-slot=input-group]")
					?.querySelector('input[aria-label="Filter by path or destination"]') &&
				el.getAttribute("aria-label") !== "Close" &&
				el.textContent.trim() !== "Close",
		)
		.map(
			(el) =>
				`${el.tagName.toLowerCase()}#${el.id}[${el.getAttribute("name") ?? el.getAttribute("aria-label") ?? el.textContent.trim().slice(0, 20)}]`,
		);
const COUNT_CONTROLS = (root) =>
	[...root.querySelectorAll("input, select, textarea, [role=switch], [role=combobox]")].filter(
		(el) => el.type !== "hidden" && el.getClientRects().length > 0,
	).length;

/** Visits every enabled tab of the open View window and throws if any control can change data; needs fields on the first tab */
export async function assertViewOnly(dialog, what) {
	const tabs = await dialog
		.locator("[role=tab]")
		.evaluateAll((list) => list.filter((tab) => !tab.disabled).map((tab) => tab.dataset.tab));
	if (tabs.length === 0) throw new Error(`${what}: the View window has no tab`);
	let first = true;
	for (const tab of tabs) {
		// biome-ignore lint/performance/noAwaitInLoops: one tab after another
		await openTab(dialog, tab);
		// biome-ignore lint/performance/noAwaitInLoops: one card after another
		for (
			let card = dialog
				.locator("button[aria-expanded=false]:not([role=combobox])")
				.filter({ visible: true })
				.first();
			await card.count();
		) {
			await card.click();
			card = dialog.locator("button[aria-expanded=false]:not([role=combobox])").filter({ visible: true }).first();
		}
		const enabled = await dialog.evaluate(ENABLED_CONTROLS);
		if (enabled.length > 0) throw new Error(`${what}: enabled controls on the ${tab} tab: ${enabled.join(", ")}`);
		if (first && (await dialog.evaluate(COUNT_CONTROLS)) === 0)
			throw new Error(`${what}: no field on the first tab`);
		first = false;
	}
}

/** Uploads a self-signed custom certificate named niceName (needs openssl, like config-check.js); returns its row */
export async function uploadCertificate(api, niceName) {
	const dir = mkdtempSync(join(tmpdir(), "flows-"));
	const certificate = join(dir, "cert.pem");
	const key = join(dir, "key.pem");
	execFileSync(
		"openssl",
		[
			...["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "30"],
			...["-subj", "/CN=flow.example.com", "-keyout", key, "-out", certificate],
		],
		{ stdio: "ignore" },
	);
	const row = await api("POST", "/nginx/certificates", { provider: "other", nice_name: niceName });
	const file = (name, path) => ({ name, mimeType: "application/x-pem-file", buffer: readFileSync(path) });
	await api("POST", `/nginx/certificates/${row.id}/upload`, {
		multipart: {
			certificate: file("certificate.pem", certificate),
			certificate_key: file("certificate_key.pem", key),
		},
	});
	return row;
}

/**
 * Opens a page through the main menu link of the top bar, as a user does (no reload, so the query cache of the pages
 * visited before stays). A menu that is not shown is an app problem: the error says what the page had.
 */
export async function openFromMenu(page, href) {
	const link = page.locator(`header nav a[href="${href}"]`);
	await link.first().waitFor({ state: "attached" });
	if (!(await link.filter({ visible: true }).count())) {
		const layout = await page.evaluate(() => window.localStorage.getItem("npmpro-nav"));
		throw new Error(
			`the menu link ${href} is not visible (viewport ${JSON.stringify(page.viewportSize())}, npmpro-nav ${layout})`,
		);
	}
	await link.filter({ visible: true }).first().click();
	await page.waitForURL(`**${href}`);
}

/** removeFlowData for a finally block: a failed cleanup is logged and never replaces the failure of the flow */
export async function cleanUp(api) {
	try {
		await removeFlowData(api, false);
	} catch (error) {
		console.error(`cleanup failed: ${String(error.message).split("\n")[0]}`);
	}
}

/** Removes what the flows create (not the viewer when withViewer is false, for a flow that is not the last): hosts and streams named flow-..., access lists named flow-... and the viewer */
export async function removeFlowData(api, withViewer = true) {
	const isFlow = (text) => String(text ?? "").startsWith("flow-");
	const [proxy, redirection, dead, streams, lists, users, certificates] = await Promise.all(
		[
			"/nginx/proxy-hosts",
			"/nginx/redirection-hosts",
			"/nginx/dead-hosts",
			"/nginx/streams",
			"/nginx/access-lists",
			"/users",
			"/nginx/certificates",
		].map((path) => api("GET", path)),
	);
	const paths = [
		...proxy.filter((row) => row.domain_names.some(isFlow)).map((row) => `/nginx/proxy-hosts/${row.id}`),
		...redirection
			.filter((row) => row.domain_names.some(isFlow))
			.map((row) => `/nginx/redirection-hosts/${row.id}`),
		...dead.filter((row) => row.domain_names.some(isFlow)).map((row) => `/nginx/dead-hosts/${row.id}`),
		...streams.filter((row) => isFlow(row.npmpro_description)).map((row) => `/nginx/streams/${row.id}`),
		...lists.filter((row) => isFlow(row.name)).map((row) => `/nginx/access-lists/${row.id}`),
		...users.filter((row) => withViewer && row.email === VIEWER_EMAIL).map((row) => `/users/${row.id}`),
		...certificates.filter((row) => isFlow(row.nice_name)).map((row) => `/nginx/certificates/${row.id}`),
	];
	for (const path of paths) {
		// biome-ignore lint/performance/noAwaitInLoops: one request after another
		await api("DELETE", path);
	}
}
