// The browser flows of the image smoke test (.github/workflows/docker.yml), run after the CSP check on the same
// container: the four host lists and their windows, the View window of a limited user, a proxy host with a location
// and an access list, a save nginx refuses and its re-save, the unsaved-changes question, a settings save, the phone
// list, the MFA and help windows and the language switch. Flows create their data and remove it (names flow-...).
// Usage: FLOWS_PASSWORD=... node scripts/flows/run.js <base URL> [chromium|webkit] [flow name ...]
// The instance must be set up (the CSP check does that); FLOWS_PASSWORD is the password of admin@example.com.
import { randomBytes } from "node:crypto";
import process from "node:process";
import { chromium, webkit } from "playwright";
import { appFlows } from "./app.js";
import { hostFlows } from "./hosts.js";
import { ADMIN_EMAIL, removeFlowData, signIn, VIEWER_EMAIL } from "./lib.js";
import { windowFlows } from "./windows.js";

const [base = "https://127.0.0.1:81", engine = "chromium", ...only] = process.argv.slice(2);
// biome-ignore lint/style/noProcessEnv: the password of the first user comes from the workflow
const password = process.env.FLOWS_PASSWORD;
if (!password) throw new Error("FLOWS_PASSWORD is not set");
const viewerPassword = `Flow-${randomBytes(12).toString("hex")}-1`;
// the limited user: views every host type and what their windows read, manages nothing
const VIEWER_PERMISSIONS = {
	visibility: "all",
	proxy_hosts: "view",
	redirection_hosts: "view",
	dead_hosts: "view",
	streams: "view",
	access_lists: "view",
	certificates: "view",
};

const flows = [...hostFlows, ...windowFlows, ...appFlows].filter(
	(flow) => only.length === 0 || only.includes(flow.name),
);
// FLOWS_CDP (a remote Chromium's DevTools WebSocket URL, for machines that cannot launch one) is for local runs only;
// the smoke test launches Chromium itself.
// biome-ignore lint/style/noProcessEnv: the switch is read once
const cdp = process.env.FLOWS_CDP;
const browser = cdp ? await chromium.connectOverCDP(cdp) : await (engine === "webkit" ? webkit : chromium).launch();
const failed = [];
try {
	const admin = await signIn(browser, base, ADMIN_EMAIL, password);
	// what a run that stopped half way left
	await removeFlowData(admin.api);
	const viewer = await admin.api("POST", "/users", {
		name: "Flow Viewer",
		email: VIEWER_EMAIL,
		roles: [],
		is_disabled: false,
		auth: { type: "password", secret: viewerPassword },
	});
	await admin.api("PUT", `/users/${viewer.id}/permissions`, VIEWER_PERMISSIONS);
	const env = { browser, base, admin, password, viewerPassword };
	for (const flow of flows) {
		const errorsBefore = admin.errors.length;
		const started = Date.now();
		try {
			// biome-ignore lint/performance/noAwaitInLoops: one flow after another on the one admin session
			await flow.run(env);
			const errors = admin.errors.slice(errorsBefore);
			if (errors.length > 0) throw new Error(`page error: ${errors[0]}`);
			console.log(`ok ${flow.name} (${Date.now() - started} ms)`);
		} catch (error) {
			failed.push(flow.name);
			console.log(`FAIL ${flow.name}: ${error.message.split("\n")[0]} (page ${admin.page.url()})`);
		}
	}
	await removeFlowData(admin.api);
} catch (error) {
	console.error(`${engine}: the run stopped: ${error.message.split("\n")[0]}`);
	process.exitCode = 1;
} finally {
	try {
		await browser.close();
	} catch (error) {
		console.error(`${engine}: the browser did not close: ${error.message.split("\n")[0]}`);
	}
}
console.log(`${engine}: ${flows.length - failed.length} of ${flows.length} flows passed`);
if (failed.length > 0) {
	console.log(`failed: ${failed.join(", ")}`);
	process.exitCode = 1;
}
