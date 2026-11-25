// The host record option (PR 8b): the DNS card's switch and boxes in a host window, a confirmed tick that is refused on
// Save, the buttons of a name that already holds a record, the View window and the managed and orphan rows of the
// Dynamic DNS list. CI has no public address and calls no provider: the plan, the reach probe, the host's record
// states and the list are routed answers where the flow needs a state the instance cannot make. The flow creates its
// data as flow-... and removes it, also when a step fails.
import {
	addDomain,
	cleanUp,
	rowAction,
	rowOf,
	saveWindowSent,
	signIn,
	VIEWER_EMAIL,
	windowClosed,
	windowTitled,
} from "./lib.js";

const CREDENTIAL = "flow-hr";
const ZONE = "flow-hr.example";
const NAME_A = "a.flow-hr.example";
// no credential covers this one; the flow- label keeps it inside the flows' cleanup
const NAME_B = "b.flow-other.example";
const ORPHAN = "orphan.flow-hr.example";
const SWITCH = "Create DNS records for this host";
const PUBLIC_ADDRESS = "203.0.113.7";
const FOUND_ADDRESS = "198.51.100.9";
const PLAN_ROUTE = "**/api/nginx/dns-check/plan";
const REACH_ROUTE = "**/api/nginx/dns-check/reach";
const DDNS_LIST = /\/api\/nginx\/ddns-records(?:\?.*)?$/u;
const HOST_RECORD_ACTION = /\/ddns-records\/\d+\/(?:adopt|leave|remove-at-provider)$/u;
const OPEN_HOST = /^Open host/u;
const NO_CREDENTIAL = "No saved credential covers this name";
const NO_ADDRESS = "No public address found";
const CONFIRM_BOX = "I checked from outside that ports 80 and 443 reach this server";
const FAKE_MANAGED = 900_001;
const FAKE_ORPHAN = 900_002;

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

// what the plan route answers for a name
const planOf = (name) =>
	name === NAME_A
		? {
				name,
				available: true,
				reason: null,
				message: null,
				covered_by: null,
				credential: { id: 1, name: CREDENTIAL },
				zone: ZONE,
				provider_label: "Cloudflare",
				address: PUBLIC_ADDRESS,
				ipv6_address: null,
				ttl: 300,
				proxied_allowed: false,
				existing: null,
			}
		: {
				name,
				available: false,
				reason: "error.host-dns-no-credential",
				message: NO_CREDENTIAL,
				covered_by: null,
				credential: null,
				zone: null,
				provider_label: null,
				address: null,
				ipv6_address: null,
				ttl: null,
				proxied_allowed: false,
				existing: null,
			};

const planAnswer = (names) => ({
	address: PUBLIC_ADDRESS,
	ipv6_address: null,
	host_disabled: false,
	names: names.map(planOf),
});

// the state of a name that already holds another record at the provider
const existsState = (name) => ({
	name,
	state: "exists",
	origin: null,
	record_id: FAKE_MANAGED,
	ipv6: false,
	message: `A ${FOUND_ADDRESS} already exists here`,
	reason: "host-dns.exists",
	covered_by: null,
	found: [{ type: "A", values: [FOUND_ADDRESS] }],
	adopt_allowed: true,
});

// a host's GET answered with the states of its names
async function routeHostStates(page, hostId, states) {
	const route = new RegExp(`/api/nginx/proxy-hosts/${hostId}(\\?.*)?$`, "u");
	const handler = async (one) => {
		if (one.request().method() !== "GET") return one.fallback();
		const answer = await one.fetch();
		return one.fulfill({ response: answer, json: { ...(await answer.json()), npmpro_dns_records: states } });
	};
	await page.route(route, handler);
	return () => page.unroute(route, handler);
}

const recordLine = (page, name) =>
	page.getByRole("dialog").locator(`[data-dns-record="${name}"]`).filter({ visible: true });
const boxOf = (line, name) => line.getByRole("checkbox", { name, exact: true });
const switchOf = (dialog) => dialog.getByRole("switch", { name: SWITCH, exact: true });

async function closeWindow(page, dialog) {
	await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
	const ask = page.getByRole("alertdialog");
	const question = await ask
		.getByRole("heading", { name: "Unsaved changes" })
		.waitFor({ timeout: 3000 })
		.then(
			() => true,
			() => false,
		);
	if (question) await ask.getByRole("button", { name: "Discard changes", exact: true }).click();
	await windowClosed(page);
}

async function openHost(page, name, title = "Edit Proxy Host") {
	await page.goto("/nginx/proxy");
	await rowAction(page, name, title.startsWith("View") ? "View" : "Edit");
	await windowTitled(page, title);
	const dialog = page.getByRole("dialog");
	await switchOf(dialog).waitFor();
	return dialog;
}

// a question that sends nothing: it opens, says what it asks, and Cancel leaves everything as it was
async function askAndCancel(page, { trigger, title, sent }) {
	await trigger.click();
	const ask = page.getByRole("alertdialog");
	await ask.getByRole("heading", { name: title, exact: true }).waitFor();
	if (sent.length > 0) throw new Error(`${title}: a request was sent before the answer: ${sent[0]}`);
	await ask.getByRole("button", { name: "Cancel", exact: true }).click();
	await ask.waitFor({ state: "detached" });
	if (sent.length > 0) throw new Error(`${title}: Cancel sent ${sent[0]}`);
}

// 1: a new host, real answers: the switch is off, the names are listed unticked, each says why it cannot be ticked
async function newHost({ admin }) {
	const { page } = admin;
	await page.goto("/nginx/proxy");
	await page.getByRole("button", { name: "Add Proxy Host", exact: true }).first().click();
	await windowTitled(page, "Add Proxy Host");
	const dialog = page.getByRole("dialog");
	await addDomain(dialog, NAME_A);
	await addDomain(dialog, NAME_B);
	const toggle = switchOf(dialog);
	await toggle.waitFor();
	if (await toggle.isChecked()) throw new Error("the host record switch is on for a new host");
	if ((await dialog.locator("[data-dns-records]").count()) !== 0)
		throw new Error("names are listed with the switch off");
	await toggle.click();
	await dialog.locator("[data-dns-records]").waitFor();
	const lineB = recordLine(page, NAME_B);
	await lineB.waitFor();
	await lineB.getByText(NO_CREDENTIAL, { exact: true }).waitFor();
	const boxB = boxOf(lineB, NAME_B);
	if (await boxB.isChecked()) throw new Error("the name without a credential is ticked");
	if (!(await boxB.isDisabled())) throw new Error("the name without a credential can be ticked");
	const lineA = recordLine(page, NAME_A);
	await lineA.waitFor();
	const boxA = boxOf(lineA, NAME_A);
	if (await boxA.isChecked()) throw new Error("the covered name is ticked");
	// the plan of a name the credential covers needs this server's public address (CI has none) and a read at the
	// provider (the flow's credential is no real one): the branch is logged
	await page.waitForFunction((name) => {
		const line = document.querySelector(`[role=dialog] [data-dns-record="${name}"]`);
		const box = line?.querySelector("[role=checkbox]");
		return Boolean(line) && (box?.disabled === false || line.textContent.replace(name, "").trim().length > 0);
	}, NAME_A);
	const tickable = !(await boxA.isDisabled());
	const text = (await lineA.textContent()).replace(NAME_A, "").trim();
	console.log(`host dns record: ${NAME_A} is ${tickable ? "tickable" : `unavailable (${text.split("\n")[0]})`}`);
	if (!tickable && text.length === 0) throw new Error("a name that cannot be ticked does not say why");
	if (!tickable && !text.includes(NO_ADDRESS) && !text.includes("could not be read"))
		console.log(`host dns record: unexpected reason ${text}`);
	// off again: the names go
	await toggle.click();
	await dialog.locator("[data-dns-records]").waitFor({ state: "detached" });
	await closeWindow(page, dialog);
}

// 2: routed plan and reach answers: the confirmation box, a refused Save for the name only, the no-address untick
async function tickAndSave({ admin }, hostId) {
	const { page, api } = admin;
	let reach = { result: "could-not-confirm", port: 80, detail: null, address: PUBLIC_ADDRESS };
	const reachHandler = (route) => route.fulfill(json(reach));
	const planHandler = (route) => route.fulfill(json(planAnswer(route.request().postDataJSON().names)));
	await page.route(PLAN_ROUTE, planHandler);
	await page.route(REACH_ROUTE, reachHandler);
	try {
		const dialog = await openHost(page, NAME_A);
		await switchOf(dialog).click();
		const lineA = recordLine(page, NAME_A);
		const lineB = recordLine(page, NAME_B);
		await lineB.getByText(NO_CREDENTIAL, { exact: true }).waitFor();
		if (!(await boxOf(lineB, NAME_B).isDisabled())) throw new Error("the uncovered name can be ticked");
		const boxA = boxOf(lineA, NAME_A);
		await page.waitForFunction(
			(name) =>
				document.querySelector(`[role=dialog] [data-dns-record="${name}"] [role=checkbox]`)?.disabled === false,
			NAME_A,
		);

		// no public address at the probe: the name is unticked and says so
		reach = { result: "no-public-address", port: null, detail: null, address: null };
		await boxA.click();
		await lineA.locator("[data-dns-reach=no-public-address]").waitFor();
		if (await boxA.isChecked()) throw new Error("a name with no public address stays ticked");

		// the probe could not confirm: the confirmation box, the line of what Save will create
		reach = { result: "could-not-confirm", port: 80, detail: null, address: PUBLIC_ADDRESS };
		await boxA.click();
		await lineA.locator("[data-dns-reach=could-not-confirm]").waitFor();
		const confirm = boxOf(lineA, CONFIRM_BOX);
		await confirm.waitFor();
		const create = lineA.locator("[data-dns-will-create]");
		await create.waitFor();
		const created = await create.textContent();
		for (const part of [PUBLIC_ADDRESS, "TTL 300", "Cloudflare", ZONE]) {
			if (!created.includes(part)) throw new Error(`the will-create line lacks ${part}: ${created}`);
		}
		await confirm.click();
		if (!(await confirm.isChecked())) throw new Error("the confirmation box did not tick");
		await confirm.click();
		if (await confirm.isChecked()) throw new Error("the confirmation box did not untick");

		// Save without the confirmation: the host saves, the name is refused (never a record), the other name is not asked
		const answer = page.waitForResponse(
			(response) =>
				response.request().method() === "PUT" && response.url().includes(`/api/nginx/proxy-hosts/${hostId}`),
		);
		const body = await saveWindowSent(page, "Proxy Host", `/nginx/proxy-hosts/${hostId}`);
		const wanted = body.npmpro_dns_records;
		if (JSON.stringify(wanted?.map((one) => one.name)) !== JSON.stringify([NAME_A]))
			throw new Error(`the save asked for ${JSON.stringify(wanted)}`);
		if (wanted[0].reach_confirmed === true) throw new Error("the save carried a confirmation nobody gave");
		const states = (await (await answer).json()).npmpro_dns_records ?? [];
		const state = states.find((one) => one.name === NAME_A);
		if (!state || state.state === "ok") throw new Error(`the refused name answered ${JSON.stringify(state)}`);
		console.log(`host dns record: the refused save answered ${state.state} (${state.reason})`);
		if (states.some((one) => one.name === NAME_B && one.state !== "off"))
			throw new Error("the uncovered name was answered");
		if ((await api("GET", "/nginx/ddns-records")).some((row) => row.name === NAME_A))
			throw new Error("a record was made for a refused name");
		const host = await api("GET", `/nginx/proxy-hosts/${hostId}`);
		if (!host.domain_names.includes(NAME_A)) throw new Error("the host was not saved");
	} finally {
		await page.unroute(PLAN_ROUTE, planHandler);
		await page.unroute(REACH_ROUTE, reachHandler);
	}
}

// 3: a name that holds another record: Adopt and update and Leave alone, each asks first
async function existingRecord({ admin }, hostId) {
	const { page } = admin;
	const sent = [];
	const watch = (request) => {
		if (request.method() === "POST" && HOST_RECORD_ACTION.test(request.url())) sent.push(request.url());
	};
	page.on("request", watch);
	const planHandler = (route) => route.fulfill(json(planAnswer(route.request().postDataJSON().names)));
	await page.route(PLAN_ROUTE, planHandler);
	const restore = await routeHostStates(page, hostId, [existsState(NAME_A)]);
	try {
		const dialog = await openHost(page, NAME_A);
		const lineA = recordLine(page, NAME_A);
		await lineA.getByText(`A ${FOUND_ADDRESS} already exists here`, { exact: true }).waitFor();
		const adopt = lineA.locator("[data-dns-record-action=adopt]");
		const leave = lineA.locator("[data-dns-record-action=leave]");
		await adopt.waitFor();
		await leave.waitFor();
		await askAndCancel(page, { trigger: leave, title: "Leave alone", sent });
		await askAndCancel(page, { trigger: adopt, title: "Adopt and update", sent });
		await adopt.waitFor();
		await leave.waitFor();
		await closeWindow(page, dialog);
	} finally {
		await restore();
		await page.unroute(PLAN_ROUTE, planHandler);
		page.off("request", watch);
	}
}

// 4: the View window of a limited user: the card is read-only
async function viewOnly({ browser, base, viewerPassword }, hostId) {
	const viewer = await signIn(browser, base, VIEWER_EMAIL, viewerPassword);
	try {
		const { page } = viewer;
		await page.route(PLAN_ROUTE, (route) => route.fulfill(json(planAnswer(route.request().postDataJSON().names))));
		await routeHostStates(page, hostId, [existsState(NAME_A)]);
		const dialog = await openHost(page, NAME_A, "View Proxy Host");
		const toggle = switchOf(dialog);
		if (!(await toggle.isDisabled())) throw new Error("the host record switch can be changed in the View window");
		const lineA = recordLine(page, NAME_A);
		await lineA.waitFor();
		await lineA.getByText(`A ${FOUND_ADDRESS} already exists here`, { exact: true }).waitFor();
		const boxes = dialog.locator("[data-dns-records] [role=checkbox]");
		if ((await boxes.evaluateAll((all) => all.filter((box) => !box.disabled).length)) > 0)
			throw new Error("a record box can be changed in the View window");
		if ((await dialog.locator("[data-dns-record-action=adopt], [data-dns-record-action=leave]").count()) !== 0)
			throw new Error("the View window offers Adopt or Leave alone");
		if ((await dialog.getByRole("button", { name: "Save" }).count()) !== 0)
			throw new Error("the View window can save");
		await page.keyboard.press("Escape");
		await windowClosed(page);
		if (viewer.errors.length > 0) throw new Error(`page error for the viewer: ${viewer.errors[0]}`);
	} finally {
		await viewer.context.close();
	}
}

const fakeRow = (id, name, hostId, orphan) => ({
	id,
	created_on: "2026-01-01 00:00:00",
	modified_on: "2026-01-01 00:00:00",
	owner_user_id: 1,
	dns_credential_id: null,
	provider: "cloudflare",
	name,
	zone: ZONE,
	kind: "address",
	target: null,
	ip_version: "ipv4",
	ipv6_suffix: null,
	ttl: 300,
	enabled: true,
	state: orphan ? "failed" : "ok",
	failures: 0,
	error: null,
	host_type: "proxy_host",
	host_id: hostId,
	origin: "created",
	host_label: NAME_A,
	orphan,
});

// 5: the Dynamic DNS list with a routed managed row and an orphan row
async function ddnsList({ admin }, hostId) {
	const { page } = admin;
	const sent = [];
	const watch = (request) => {
		if (
			["POST", "DELETE", "PUT"].includes(request.method()) &&
			request.url().includes(`/api/nginx/ddns-records/${FAKE_MANAGED}`.slice(0, -1))
		)
			sent.push(`${request.method()} ${request.url()}`);
	};
	page.on("request", watch);
	const handler = async (route) => {
		if (route.request().method() !== "GET") return route.fallback();
		const answer = await route.fetch();
		const rows = await answer.json();
		return route.fulfill({
			response: answer,
			json: [...rows, fakeRow(FAKE_MANAGED, NAME_A, hostId, false), fakeRow(FAKE_ORPHAN, ORPHAN, hostId, true)],
		});
	};
	await page.route(DDNS_LIST, handler);
	try {
		await page.goto("/certificates/dynamic-dns");
		const menu = async (name) => {
			await rowOf(page, name).first().waitFor();
			await page
				.getByRole("button", { name: `Actions for ${name}`, exact: true })
				.filter({ visible: true })
				.click();
		};

		// the managed row: no Edit (View instead), the host named, Open host in the menu and no Disable or Delete
		await rowOf(page, NAME_A).first().waitFor();
		await rowOf(page, NAME_A).locator("[data-ddns-managed]").filter({ visible: true }).first().waitFor();
		if ((await page.getByRole("button", { name: `Edit ${NAME_A}`, exact: true }).count()) !== 0)
			throw new Error("the managed row has an Edit button");
		await page
			.getByRole("button", { name: `View ${NAME_A}`, exact: true })
			.filter({ visible: true })
			.waitFor();
		await menu(NAME_A);
		await page.getByRole("menuitem", { name: OPEN_HOST }).waitFor();
		const offered = await page.getByRole("menuitem").allTextContents();
		const wrong = offered.filter((item) => ["Disable", "Delete", "Edit"].includes(item.trim()));
		if (wrong.length > 0) throw new Error(`the managed row offers ${wrong.join(", ")}`);
		await page.getByRole("menuitem", { name: OPEN_HOST }).click();
		await windowTitled(page, "Edit Proxy Host");
		await closeWindow(page, page.getByRole("dialog"));

		// the orphan: both ways out ask first and Cancel leaves the row
		await menu(ORPHAN);
		await askAndCancel(page, {
			trigger: page.getByRole("menuitem", { name: "Delete at the provider again", exact: true }),
			title: "Delete at the provider again",
			sent,
		});
		await menu(ORPHAN);
		await askAndCancel(page, {
			trigger: page.getByRole("menuitem", { name: "Forget", exact: true }),
			title: "Forget",
			sent,
		});
		await rowOf(page, ORPHAN).first().waitFor();
		await rowOf(page, ORPHAN).locator("[data-ddns-orphan]").filter({ visible: true }).first().waitFor();
	} finally {
		await page.unroute(DDNS_LIST, handler);
		page.off("request", watch);
	}
}

async function hostDnsRecord(env) {
	const { admin } = env;
	try {
		await admin.api("POST", "/nginx/dns-credentials", {
			name: CREDENTIAL,
			provider: "cloudflare",
			ini: "dns_cloudflare_api_token=flow-token",
			domains: [ZONE],
		});
		await newHost(env);
		const host = await admin.api("POST", "/nginx/proxy-hosts", {
			domain_names: [NAME_A, NAME_B],
			forward_scheme: "http",
			forward_host: "127.0.0.1",
			forward_port: 8080,
		});
		await tickAndSave(env, host.id);
		await existingRecord(env, host.id);
		await viewOnly(env, host.id);
		await ddnsList(env, host.id);
	} finally {
		await cleanUp(admin.api);
	}
}

export const hostDnsFlows = [{ name: "host dns record", run: hostDnsRecord }];
