// Settings, Notifications, Webhooks: a webhook is added (the guard refuses a loopback URL first), its signing secret is
// shown once and gone from the page after the window closes, Send test fails against an address that never answers, the
// Deliveries window opens, the secret is rotated, the webhook is turned off and on, changed to two chosen events and
// deleted. There is no receiver, so no delivery exists: the paging and the stop of the refresh of the Deliveries window
// are not covered here (the live check with a receiver covers them). The flow leaves no webhook behind.
//
// The test route shares the test limiter with the test mail and the sample alert (5 a minute per address): the
// notifications flow before this one sends 2 (this flow's test is the third in that minute) and the CSP check sends none.
// An answer of the limiter fails the flow, except on a marked rerun (FLOWS_RERUN=1), which only logs it.

import process from "node:process";
import { rowAction, rowGone, rowOf, rowShows, windowClosed } from "./lib.js";

const NAME = "flow-hook";
const GUARDED_URL = "https://127.0.0.1/";
// a documentation address (TEST-NET-1): the guard allows it and nothing answers
const SILENT_URL = "https://192.0.2.10/flow";
const BLOCKED = /may not send requests to 127\.0\.0\.1/u;
const TEST_FAILED = /The test failed after \d+ ms/u;
const COPY_BUTTON = /^Copy/u;
const TOO_MANY = "Too many requests, try again later.";
// the secret is shown after the 15 s the test waits for the receiver; the wait below leaves room for the browser
const TEST_WAIT = 30_000;
// biome-ignore lint/style/noProcessEnv: a rerun of the flows on the same instance is marked from the command line
const RERUN = process.env.FLOWS_RERUN === "1";

const dialogOf = (page) => page.getByRole("dialog");
const storedWebhooks = (api) => api("GET", "/webhooks");

async function openAddWindow(page) {
	await page.getByRole("button", { name: "Add webhook", exact: true }).filter({ visible: true }).first().click();
	const dialog = dialogOf(page);
	await dialog.getByRole("heading", { name: "Add webhook", exact: true }).waitFor();
	return dialog;
}

// the secret window: the text of the box, starting with whsec_; Copy is clicked (a browser without clipboard access
// selects the text instead, so no toast is expected)
async function readSecret(page) {
	const dialog = dialogOf(page);
	await dialog.getByRole("heading", { name: "Signing secret", exact: true }).waitFor();
	const box = dialog.locator("[data-webhook-secret]");
	await box.waitFor();
	const secret = ((await box.textContent()) ?? "").replaceAll(/\s+/gu, "");
	if (!secret.startsWith("whsec_")) throw new Error("the signing secret does not start with whsec_");
	await dialog.getByRole("button", { name: COPY_BUTTON }).click();
	return secret;
}

// closing the window drops the secret: it is in no element of the page any more
async function closeSecretWindow(page, secret) {
	await dialogOf(page).getByRole("button", { name: "Done", exact: true }).click();
	await windowClosed(page);
	if ((await page.locator("body").textContent()).includes(secret))
		throw new Error("the signing secret is still in the page after its window closed");
}

// a window that is refused at the save keeps its error inside; the guard names the loopback address
async function guardRefusal(page, api) {
	const dialog = await openAddWindow(page);
	await dialog.locator("input[name=name]").fill(NAME);
	await dialog.locator("input[name=url]").fill(GUARDED_URL);
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await dialog.getByText(BLOCKED).filter({ visible: true }).first().waitFor({ timeout: 10_000 });
	if ((await storedWebhooks(api)).some((hook) => hook.name === NAME))
		throw new Error("the webhook with the loopback URL was saved");
	return dialog;
}

// Send test: the receiver never answers, so the toast says the test failed (or the limiter answers on a rerun)
async function sendTest(page) {
	const started = Date.now();
	await rowAction(page, NAME, "Send test");
	const answer = await Promise.race([
		page
			.locator("[data-sonner-toast]")
			.filter({ hasText: TEST_FAILED })
			.first()
			.waitFor({ timeout: TEST_WAIT })
			.then(() => "failed"),
		page
			.locator("[data-sonner-toast]")
			.filter({ hasText: TOO_MANY })
			.first()
			.waitFor({ timeout: TEST_WAIT })
			.then(() => "limited"),
	]);
	if (answer === "limited" && !RERUN) throw new Error("Send test was answered by the limiter (not a rerun)");
	console.log(
		`webhooks: the test ${answer === "failed" ? `failed as expected after ${Date.now() - started} ms` : "was answered by the limiter"}`,
	);
}

// the Deliveries window: the test is not a delivery, so it is empty (or holds rows another flow made); it closes again
async function deliveries(page) {
	await rowAction(page, NAME, "Deliveries");
	const dialog = dialogOf(page);
	await dialog.getByRole("heading", { name: `Deliveries of ${NAME}`, exact: true }).waitFor();
	const state = await Promise.race([
		dialog
			.locator("[data-webhook-deliveries-empty]")
			.waitFor()
			.then(() => "empty"),
		dialog
			.locator("[data-webhook-deliveries]")
			.waitFor()
			.then(() => "rows"),
	]);
	console.log(`webhooks: the Deliveries window is ${state}`);
	await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
	await windowClosed(page);
}

async function rotate(page, first) {
	await rowAction(page, NAME, "Rotate secret");
	const ask = page.getByRole("alertdialog");
	await ask.getByRole("heading", { name: "Rotate the signing secret?", exact: true }).waitFor();
	await ask.getByRole("button", { name: "Rotate secret", exact: true }).click();
	const second = await readSecret(page);
	if (second === first) throw new Error("the rotated secret equals the first one");
	await closeSecretWindow(page, second);
}

// Disable shows the badge, Enable removes it again
async function toggle(page, api) {
	await rowAction(page, NAME, "Disable");
	await rowShows(page, NAME, "Disabled");
	await rowAction(page, NAME, "Enable");
	await rowOf(page, NAME).filter({ hasNotText: "Disabled" }).first().waitFor();
	if (!(await storedWebhooks(api)).find((hook) => hook.name === NAME)?.enabled)
		throw new Error("the webhook is not enabled after Enable");
}

// Edit: All events off, two events chosen, saved; the list says 2 events
async function chooseEvents(page, api) {
	await rowAction(page, NAME, "Edit");
	const dialog = dialogOf(page);
	await dialog.getByRole("heading", { name: "Edit webhook", exact: true }).waitFor();
	await dialog.locator('[id$="-all-events"]').setChecked(false);
	await dialog.locator('[id$="-event-host-created"]').setChecked(true);
	await dialog.locator('[id$="-event-host-deleted"]').setChecked(true);
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await windowClosed(page);
	await rowShows(page, NAME, "2 events");
	const events = (await storedWebhooks(api)).find((hook) => hook.name === NAME)?.events;
	if (
		JSON.stringify([...(events ?? [])].sort((a, b) => a.localeCompare(b))) !==
		JSON.stringify(["host.created", "host.deleted"])
	)
		throw new Error(`the stored events are ${JSON.stringify(events)}`);
}

async function removeHooks(api) {
	const hooks = (await storedWebhooks(api)).filter((item) => item.name.startsWith("flow-"));
	for (const hook of hooks) {
		// biome-ignore lint/performance/noAwaitInLoops: one request after another
		await api("DELETE", `/webhooks/${hook.id}`);
	}
}

async function webhooks({ admin }) {
	const { page, api } = admin;
	try {
		await removeHooks(api);
		await page.goto("/settings/notifications");
		await page.locator("#notifications-webhooks-title").waitFor();

		// 1: the guard refuses the loopback address, the window stays open and nothing is saved
		const dialog = await guardRefusal(page, api);
		// 2: a URL nothing answers on, all events: saved, and the secret window shows the secret once
		await dialog.locator("input[name=url]").fill(SILENT_URL);
		if (!(await dialog.locator('[id$="-all-events"]').isChecked()))
			throw new Error("All events is not on by default");
		await dialog.getByRole("button", { name: "Save", exact: true }).click();
		const first = await readSecret(page);
		await closeSecretWindow(page, first);
		await rowShows(page, NAME, "All events");
		// 3, 4
		await sendTest(page);
		await deliveries(page);
		// 5
		await rotate(page, first);
		// 6
		await toggle(page, api);
		await chooseEvents(page, api);
		// 7: Delete asks, then the row is gone
		await rowAction(page, NAME, "Delete");
		await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
		await rowGone(page, NAME);
		if ((await storedWebhooks(api)).some((hook) => hook.name === NAME))
			throw new Error("the webhook is still stored");
	} finally {
		await removeHooks(api).catch((error) => console.log(`webhooks: the cleanup failed (${error.message})`));
	}
}

export const webhookFlows = [{ name: "webhooks", run: webhooks }];
