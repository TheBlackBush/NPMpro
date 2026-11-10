// Helpers of the browser flows (scripts/flows/run.js): sessions, API calls with a session's cookie, and waits on what
// the page shows. Every wait is on a state of the page, never on time.

export const ADMIN_EMAIL = "admin@example.com";
export const VIEWER_EMAIL = "flow-viewer@example.com";

const CONTEXT = { ignoreHTTPSErrors: true, locale: "en-US", viewport: { width: 1440, height: 900 } };

function apiOf(context, base) {
	return async (method, path, data) => {
		const answer = await context.request.fetch(`${base}/api${path}`, { method, data });
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
export async function signIn(browser, base, email, password, viewport = CONTEXT.viewport) {
	const context = await browser.newContext({ ...CONTEXT, viewport, baseURL: base });
	const page = await context.newPage();
	page.setDefaultTimeout(15_000);
	page.setDefaultNavigationTimeout(30_000);
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/");
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

/** Removes what the flows create: hosts and streams named flow-..., access lists named flow-... and the viewer */
export async function removeFlowData(api) {
	const isFlow = (text) => String(text ?? "").startsWith("flow-");
	const [proxy, redirection, dead, streams, lists, users] = await Promise.all(
		[
			"/nginx/proxy-hosts",
			"/nginx/redirection-hosts",
			"/nginx/dead-hosts",
			"/nginx/streams",
			"/nginx/access-lists",
			"/users",
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
		...users.filter((row) => row.email === VIEWER_EMAIL).map((row) => `/users/${row.id}`),
	];
	for (const path of paths) {
		// biome-ignore lint/performance/noAwaitInLoops: one request after another
		await api("DELETE", path);
	}
}
