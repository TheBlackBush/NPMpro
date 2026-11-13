// The CSP gate of the image smoke test (.github/workflows/docker.yml): opens every page and the listed menus and
// windows of a fresh NPMpro in a real browser and fails on any Content Security Policy violation or page error.
// The pages and actions are in scripts/csp-check.json; new UI parts add theirs there. Links found on the
// pages are followed too (the Settings sections, the Monitoring tabs). An action's steps are objects with
// one of: click, hover (the pointer moves to the element's centre in steps), waitFor (selectors), gone (a
// selector: waits until it is hidden or removed, e.g. a tooltip after its menu opened), press (a key),
// viewport ([width, height], until the action ends), skipIfDisabled (a selector: the rest of the action
// is skipped, and logged, when that control is disabled, e.g. by an env var), skipIfMissing (a selector:
// the same when it is not on the page within 5 s, e.g. the map without GeoIP databases), seedAccessLists
// (a number: that many access lists named flow-csp-NN are created through the API, so a list has a paging
// bar; they are removed when the action ends) or reload (the page is reloaded).
// Usage: node scripts/csp-check.js <base URL> [chromium|webkit]
// The browser flows (scripts/flows/run.js) run after it on the same instance.
// A fresh instance gets its first user through the setup page (a random password); for an instance that is already
// set up, give that user's password in CSP_CHECK_PASSWORD (email admin@example.com).
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import { chromium, webkit } from "playwright";

const [base = "https://127.0.0.1:81", engine = "chromium"] = process.argv.slice(2);
const { routes, actions } = JSON.parse(readFileSync(new URL("csp-check.json", import.meta.url), "utf8"));
const EMAIL = "admin@example.com";
// biome-ignore lint/style/noProcessEnv: a local run against an instance that is already set up
const password = process.env.CSP_CHECK_PASSWORD || `Ci-${randomBytes(12).toString("hex")}-9`;
const VIOLATION = /Content Security Policy/iu;
const problems = [];
// the paths opened and the paths they ended on (/settings redirects to /settings/landing-pages)
const visited = new Set();

// the access lists an action made with seedAccessLists, removed when it ends
const seeded = [];
const browser = await (engine === "webkit" ? webkit : chromium).launch();
const options = { ignoreHTTPSErrors: true, locale: "en-US", viewport: { width: 1440, height: 900 } };

/** A page that records CSP violations and page errors under the name of what it is doing (page.step) */
async function watchedPage(browserContext) {
	await browserContext.addInitScript(() => {
		// the event also covers violations a browser does not log to the console
		document.addEventListener("securitypolicyviolation", (event) => {
			console.error(
				`Content Security Policy violation (event): ${event.effectiveDirective} blocked ${event.blockedURI || "inline"} at ${event.sourceFile}:${event.lineNumber}`,
			);
		});
	});
	const watched = await browserContext.newPage();
	// a missing button fails its action in 10 s, not 30
	watched.setDefaultTimeout(10_000);
	// navigations get 30 s on a cold runner (the page's own default would shadow a context setting)
	watched.setDefaultNavigationTimeout(30_000);
	watched.step = "start";
	watched.on("console", (message) => {
		if (VIOLATION.test(message.text())) problems.push(`${watched.step}: ${message.text()}`);
	});
	watched.on("pageerror", (error) => problems.push(`${watched.step}: page error: ${error.message}`));
	return watched;
}

// the session's own requests: the same cookie as the page
let session;
const apiOf = (method, path, data) => session.request.fetch(`${base}/api${path}`, { method, data });

async function seedAccessLists(count) {
	for (let index = 1; index <= count; index++) {
		// biome-ignore lint/performance/noAwaitInLoops: one request after another
		const answer = await apiOf("POST", "/nginx/access-lists", {
			name: `flow-csp-${String(index).padStart(2, "0")}`,
			satisfy_any: true,
			items: [{ username: "csp", password: "flow-password-1" }],
			clients: [{ address: "10.0.0.0/8", directive: "allow" }],
		});
		if (!answer.ok()) throw new Error(`seeding an access list failed: ${answer.status()}`);
		seeded.push((await answer.json()).id);
	}
}

async function removeSeeded() {
	for (const id of seeded.splice(0)) {
		// biome-ignore lint/performance/noAwaitInLoops: one request after another
		await apiOf("DELETE", `/nginx/access-lists/${id}`).catch(() => undefined);
	}
}

// the app's error pages (main.jsx's crash page, components/Unhealthy.jsx) carry data-error-page
async function checkErrorPage(target, where) {
	if (await target.locator("[data-error-page]").first().isVisible()) problems.push(`error page shown ${where}`);
}

async function open(target, route) {
	target.step = route;
	await target.goto(new URL(route, base).href, { waitUntil: "load" });
	// pages that poll never go idle: wait at most 5 s, then a moment for effects that run late
	await target.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
	await target.waitForTimeout(300);
	await checkErrorPage(target, `on ${route}`);
	visited.add(route);
	visited.add(new URL(target.url()).pathname);
}

async function appLinks(target) {
	const hrefs = await target.locator("a[href^='/']:not([target])").evaluateAll((all) => all.map((a) => a.pathname));
	return hrefs.filter((href) => !href.startsWith("/api"));
}

// setup on a fresh instance, then the login page itself in a context without a session
try {
	const setupContext = await browser.newContext(options);
	const setupPage = await watchedPage(setupContext);
	await open(setupPage, "/");
	// a page that polls or loads late may not show a form yet: wait for either form before choosing
	await setupPage.locator("#password, #login-email").first().waitFor();
	if ((await setupPage.locator("#password").count()) > 0) {
		setupPage.step = "setup";
		await setupPage.locator("#name").fill("Admin");
		await setupPage.locator("#email").fill(EMAIL);
		await setupPage.locator("#password").fill(password);
		await setupPage.locator("form button[type=submit]").click();
		await setupPage.locator("#login-email").or(setupPage.getByRole("navigation")).first().waitFor();
	}
	await setupContext.close();

	const context = await browser.newContext(options);
	session = context;
	const page = await watchedPage(context);
	await open(page, "/");
	// the language and theme menus of the signed-out page (dropdowns render in a portal: check each opens and closes)
	page.step = "signed-out menus";
	const menuTriggers = page.locator("button[aria-haspopup=menu]");
	await page.locator("#login-email").waitFor();
	const triggerCount = await menuTriggers.count();
	if (triggerCount !== 2) throw new Error(`expected 2 menu buttons on the signed-out page, found ${triggerCount}`);
	for (const trigger of await menuTriggers.all()) {
		// biome-ignore lint/performance/noAwaitInLoops: one menu, one after another
		await trigger.click();
		await page.getByRole("menu").waitFor();
		await page.keyboard.press("Escape");
		await page.getByRole("menu").waitFor({ state: "detached" });
	}
	page.step = "login";
	await page.locator("#login-email").fill(EMAIL);
	await page.locator("#login-password").fill(password);
	await page.locator("form button[type=submit]").click();
	await page.locator("#login-email").waitFor({ state: "detached" });

	// every listed route, then every app link found on the way that is not listed (one page at a time)
	const queue = [...routes];
	while (queue.length > 0) {
		const route = queue.shift();
		if (!visited.has(route)) {
			// biome-ignore lint/performance/noAwaitInLoops: one page, one route after another
			await open(page, route);
			for (const href of await appLinks(page)) if (!(visited.has(href) || queue.includes(href))) queue.push(href);
		}
	}

	for (const action of actions) {
		// biome-ignore lint/performance/noAwaitInLoops: one page, one action after another
		await open(page, action.route);
		page.step = `${action.route}: ${action.name}`;
		try {
			for (const step of action.steps) {
				// an action that needs a control an env var may lock (TRAFFIC_STATS): skipped, and said so, when disabled
				// biome-ignore lint/performance/noAwaitInLoops: the steps of an action run in order
				if (step.skipIfDisabled && (await page.locator(step.skipIfDisabled).first().isDisabled())) {
					console.log(`${page.step}: skipped (${step.skipIfDisabled} is disabled)`);
					break;
				}
				// an action on a part that needs outside data (the map needs GeoIP databases): skipped, and said so, when absent
				if (
					step.skipIfMissing &&
					!(await page
						.locator(step.skipIfMissing)
						.first()
						.waitFor({ timeout: 5000 })
						.then(
							() => true,
							() => false,
						))
				) {
					console.log(`${page.step}: skipped (${step.skipIfMissing} is not on the page)`);
					break;
				}
				if (step.seedAccessLists) await seedAccessLists(step.seedAccessLists);
				if (step.reload) await page.reload();
				if (step.viewport) await page.setViewportSize({ width: step.viewport[0], height: step.viewport[1] });
				if (step.click) await page.locator(step.click).first().click();
				if (step.hover) {
					// stepped pointer moves: a teleported pointer does not open a second tooltip while the first is open
					const target = page.locator(step.hover).first();
					await target.waitFor({ state: "visible" });
					await target.scrollIntoViewIfNeeded();
					const box = await target.boundingBox();
					const x = box.x + box.width / 2;
					const y = box.y + box.height / 2;
					await page.mouse.move(x, y, { steps: 8 });
					// a small move inside the element: the tooltip of the previous trigger leaves its pointer state on the last move
					await page.mouse.move(x + 3, y, { steps: 3 });
				}
				if (step.waitFor) await page.locator(step.waitFor).first().waitFor();
				if (step.gone) await page.locator(step.gone).first().waitFor({ state: "hidden" });
				if (step.press) await page.keyboard.press(step.press);
			}
			// biome-ignore lint/suspicious/noPlaywrightWaitForTimeout: what opened may still add its styles
			await page.waitForTimeout(500);
		} catch (error) {
			problems.push(
				`${page.step}: the action failed (fix scripts/csp-check.json): ${error.message.split("\n")[0]}`,
			);
		} finally {
			await removeSeeded();
			// a phone action changes the size: every action starts on the desktop size again
			await page.setViewportSize(options.viewport);
		}
		await checkErrorPage(page, `on ${action.route} (after ${action.name})`);
	}
} catch (error) {
	// a throw (login, navigation) is a failure too; the findings collected so far are printed below
	console.error(`${engine}: the run stopped: ${error.message.split("\n")[0]}`);
	process.exitCode = 1;
} finally {
	console.log(`${engine}: ${visited.size} paths, ${actions.length} actions`);
	console.log([...visited].sort((a, b) => a.localeCompare(b)).join(" "));
	for (const problem of problems) console.log(problem);
	if (problems.length > 0) {
		console.log(`${problems.length} problems`);
		process.exitCode = 1;
	}
	// the findings are printed first; a browser that does not close only gets logged
	try {
		await browser.close();
	} catch (error) {
		console.error(`${engine}: the browser did not close: ${error.message.split("\n")[0]}`);
	}
}
