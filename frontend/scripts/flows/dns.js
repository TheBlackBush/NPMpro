// The Domains of DNS credentials: the credential window's Domains line and list column, the Domains tab, Add domains
// with a name the owner keeps on another credential, Edit (move), Delete, the unsaved-changes question and the
// view-only tab. The flows create their data as flow-... and remove it.
import {
	addDomain,
	cleanUp,
	openTab,
	revealRow,
	rowAction,
	rowGone,
	rowOf,
	rowShows,
	saveWindow,
	signIn,
	uploadCertificate,
	VIEWER_EMAIL,
	windowClosed,
	windowTitled,
	withToast,
} from "./lib.js";

const NAME_A = "flow-dns-a";
const NAME_B = "flow-dns-b";
const DOMAIN_A = "flow-a.example";
const DOMAIN_B = "flow-b.example";
const DOMAIN_C = "flow-c.example";
const TAKEN_TEXT = `${DOMAIN_A} is already on the DNS credential ${NAME_A}`;

const addChip = async (dialog, name) => {
	const input = dialog.locator("#dnsDomains");
	await input.fill(name);
	await input.press("Enter");
	await dialog.locator("[data-slot=combobox-chips]").getByText(name, { exact: true }).waitFor();
};

const chooseCredential = async (page, dialog, name) => {
	await dialog.locator("#dnsCredential").click();
	await page.getByRole("option", { name: new RegExp(`^${name} `, "u") }).click();
};

async function dnsDomains({ admin, browser, base, viewerPassword }) {
	const { page, api } = admin;
	await stubZones(page);
	// answers of the create request of domains: a refused batch must never answer 201
	const created = [];
	page.on("response", (response) => {
		const request = response.request();
		if (request.method() === "POST" && new URL(response.url()).pathname === "/api/nginx/dns-domains")
			created.push(response.status());
	});
	try {
		// 1. a credential with two domains, through its window
		await page.goto("/certificates/dns-credentials");
		await page.getByRole("button", { name: "Add DNS credential", exact: true }).first().click();
		await windowTitled(page, "Add DNS credential");
		const credential = page.getByRole("dialog");
		await credential.locator("#dnsCredentialName").fill(NAME_A);
		await credential.locator("#dnsCredentialProvider").click();
		await page.getByRole("option", { name: "Cloudflare", exact: true }).click();
		await credential.locator("input[id^=dnsCredentialField-]").first().fill("flow-token");
		await addChip(credential, DOMAIN_A);
		await addChip(credential, DOMAIN_B);
		await saveWindow(page, "DNS credential");
		await rowShows(page, NAME_A, DOMAIN_A);
		await rowShows(page, NAME_A, DOMAIN_B);

		// 2. the Domains tab lists both names under the credential
		await page.goto("/certificates/domains");
		await rowShows(page, DOMAIN_A, NAME_A);
		await rowShows(page, DOMAIN_B, NAME_A);

		// 3. Add domains: a name the owner keeps on another credential is marked and refused, nothing is stored
		const second = await api("POST", "/nginx/dns-credentials", {
			name: NAME_B,
			provider: "cloudflare",
			ini: "dns_cloudflare_api_token=flow-token",
		});
		await page.reload();
		await rowShows(page, DOMAIN_A, NAME_A);
		await page.getByRole("button", { name: "Add domains", exact: true }).first().click();
		const add = page.locator("[data-dns-domains-window]");
		await add.waitFor();
		await chooseCredential(page, add, NAME_B);
		await addChip(add, DOMAIN_A);
		await add.locator("[data-dns-domain-taken]").filter({ hasText: NAME_A }).waitFor();
		const before = created.length;
		await add.getByRole("button", { name: "Save", exact: true }).click();
		await add.getByText(TAKEN_TEXT).first().waitFor();
		if (!(await add.isVisible())) throw new Error("the window closed on a refused save");
		if (created.length !== before) throw new Error(`a request was sent for a taken name: ${created.slice(before)}`);
		if (
			(await api("GET", "/nginx/dns-domains")).some(
				(row) => row.name === DOMAIN_A && row.dns_credential_id === second.id,
			)
		)
			throw new Error("the taken name was stored on the second credential");
		await add.getByRole("button", { name: `Remove ${DOMAIN_A}`, exact: true }).click();
		await add.locator("[data-dns-domain-taken]").waitFor({ state: "detached" });
		await addChip(add, DOMAIN_C);
		await add.getByRole("button", { name: "Save", exact: true }).click();
		await add.waitFor({ state: "detached" });
		if (created.at(-1) !== 201) throw new Error(`the save answered ${created.at(-1)}`);
		await rowShows(page, DOMAIN_C, NAME_B);

		// 4. Edit moves the name to the first credential
		await rowAction(page, DOMAIN_C, "Edit");
		await page.locator("[data-dns-domain-window]").waitFor();
		await windowTitled(page, "Edit DNS domain");
		await chooseCredential(page, page.locator("[data-dns-domain-window]"), NAME_A);
		await saveWindow(page, "DNS domain");
		await rowShows(page, DOMAIN_C, NAME_A);

		// 5. Delete: hosts and certificates keep their names
		await rowAction(page, DOMAIN_C, "Delete");
		const ask = page.getByRole("alertdialog");
		await ask.getByText("Hosts and certificates keep their names", { exact: false }).waitFor();
		await ask.getByRole("button", { name: "Delete", exact: true }).click();
		await rowGone(page, DOMAIN_C);

		// 6. the unsaved-changes question of the Add domains window
		await page.getByRole("button", { name: "Add domains", exact: true }).first().click();
		await add.waitFor();
		await addChip(add, "flow-d.example");
		await add.getByRole("button", { name: "Close", exact: true }).click();
		await ask.getByRole("heading", { name: "Unsaved changes" }).waitFor();
		await ask.getByRole("button", { name: "Discard changes", exact: true }).click();
		await add.waitFor({ state: "detached" });
		if ((await api("GET", "/nginx/dns-domains")).some((row) => row.name === "flow-d.example"))
			throw new Error("the discarded name was stored");

		// 7. a viewer lists the rows, cannot add, and gets the View window
		const viewer = await signIn(browser, base, VIEWER_EMAIL, viewerPassword);
		try {
			await viewer.page.goto("/certificates/domains");
			await rowShows(viewer.page, DOMAIN_A, NAME_A);
			if ((await viewer.page.getByRole("button", { name: "Add domains", exact: true }).count()) !== 0)
				throw new Error("the viewer has an Add domains button");
			await viewer.page
				.getByRole("button", { name: `View ${DOMAIN_A}`, exact: true })
				.filter({ visible: true })
				.click();
			await viewer.page.locator("[data-dns-domain-window]").waitFor();
			await windowTitled(viewer.page, "View DNS domain");
			if ((await viewer.page.getByRole("dialog").getByRole("button", { name: "Save" }).count()) !== 0)
				throw new Error("the View window can save");
			await viewer.page.keyboard.press("Escape");
			await windowClosed(viewer.page);
			if ((await viewer.page.getByRole("button", { name: `Actions for ${DOMAIN_A}`, exact: true }).count()) !== 0)
				throw new Error("the viewer has an Actions button");
			if (viewer.errors.length > 0) throw new Error(`page error for the viewer: ${viewer.errors[0]}`);
		} finally {
			await viewer.context.close();
		}
	} finally {
		await cleanUp(api);
	}
}

// The domain picker of every Domain Names field and the DNS challenge suggestion. The data is made through the API
// (no real provider, no certificate is requested); the windows are closed with their unsaved-changes question.
// two animation frames: what the last keystroke rendered is on the page, so an absence can be checked
const settled = (page) =>
	page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

const LIST_SETTLE = "[cmdk-group-heading]";

const chipsOf = (dialog) =>
	dialog
		.locator("[data-slot=combobox-chips] [data-window-start-skip]")
		.evaluateAll((list) => list.map((el) => el.textContent.trim()));

const optionNamed = (page, text) => page.getByRole("option").filter({ hasText: text });

// types into the Domain Names field without Enter: the suggestions list follows
const typeDomain = async (dialog, text) => {
	const input = dialog.locator("#domainNames");
	await input.fill("");
	await input.fill(text);
	return input;
};

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

const credentialBody = (name, domains) => ({
	name,
	provider: "cloudflare",
	ini: "dns_cloudflare_api_token=flow-token",
	domains,
});

async function domainPicker({ admin }) {
	const { page, api, errors } = admin;
	try {
		await api("POST", "/nginx/dns-credentials", credentialBody("flow-pick", ["flow-pick.example"]));
		await api("POST", "/nginx/dns-credentials", credentialBody("flow-au", ["flow-zone.com.au"]));
		await api("POST", "/nginx/proxy-hosts", {
			domain_names: ["flow-used.flow-pick.example", "flow-zone.com"],
			forward_scheme: "http",
			forward_host: "127.0.0.1",
			forward_port: 8080,
		});

		// 1. a proxy host: pick a DNS domain completion, type a free name, find a used name
		await page.goto("/nginx/proxy");
		await page.getByRole("button", { name: "Add Proxy Host", exact: true }).first().click();
		await windowTitled(page, "Add Proxy Host");
		const dialog = page.getByRole("dialog");
		await typeDomain(dialog, "app");
		await page.locator(LIST_SETTLE).filter({ hasText: "DNS domains" }).waitFor();
		await optionNamed(page, "app.flow-pick.example").first().click();
		await dialog
			.locator("[data-slot=combobox-chips]")
			.getByText("app.flow-pick.example", { exact: true })
			.waitFor();
		let input = await typeDomain(dialog, "flow-free.example");
		await input.press("Enter");
		await dialog.locator("[data-slot=combobox-chips]").getByText("flow-free.example", { exact: true }).waitFor();
		// a used name that is also a completion of a DNS domain is listed once, under DNS domains; one that is not
		// has its own heading
		await typeDomain(dialog, "flow-used");
		await optionNamed(page, "flow-used.flow-pick.example").first().waitFor();
		await typeDomain(dialog, "flow-zone");
		await page.locator(LIST_SETTLE).filter({ hasText: "Used by hosts and certificates" }).waitFor();
		await optionNamed(page, "flow-zone.com").filter({ hasText: "proxy host" }).first().waitFor();
		await typeDomain(dialog, "");
		await dialog.locator("input[name=forwardHost]").fill("127.0.0.1");
		await dialog.locator("input[name=forwardPort]").fill("8080");
		await saveWindow(page, "Proxy Host");

		// 2. the saved host holds the plain names
		const names = ["app.flow-pick.example", "flow-free.example"];
		await rowShows(page, "app.flow-pick.example", "flow-free.example");
		const saved = (await api("GET", "/nginx/proxy-hosts")).find((row) =>
			row.domain_names.includes("app.flow-pick.example"),
		);
		if (JSON.stringify([...saved.domain_names].sort((a, b) => a.localeCompare(b))) !== JSON.stringify(names))
			throw new Error(`stored names: ${saved.domain_names}`);
		await rowAction(page, "app.flow-pick.example", "Edit");
		await windowTitled(page, "Edit Proxy Host");
		const edit = page.getByRole("dialog");
		await edit.locator("[data-slot=combobox-chips]").getByText("flow-free.example", { exact: true }).waitFor();
		const held = (await chipsOf(edit)).sort((a, b) => a.localeCompare(b));
		if (JSON.stringify(held) !== JSON.stringify(names)) throw new Error(`chips after reopen: ${held}`);
		await closeWindow(page, edit);

		// a requested certificate over the HTTP challenge takes no wildcard: none is offered, none can be added
		await page.getByRole("button", { name: "Add Proxy Host", exact: true }).first().click();
		await windowTitled(page, "Add Proxy Host");
		const request = page.getByRole("dialog");
		await openTab(request, "tls");
		await request.locator("#certificateId").click();
		await page.getByRole("option", { name: "Request a new Certificate" }).click();
		await openTab(request, "details");
		await typeDomain(request, "*.flow-pick");
		await settled(page);
		if ((await optionNamed(page, "*.flow-pick.example").count()) !== 0)
			throw new Error("a wildcard is offered with an HTTP challenge");
		await typeDomain(request, "flow-pick");
		await optionNamed(page, "app.flow-pick.example").or(optionNamed(page, "flow-pick.example")).first().waitFor();
		await closeWindow(page, request);

		// 3. a full valid name typed with Enter adds exactly that name, also when a longer zone and a used name contain it
		await page.goto("/nginx/redirection");
		await page.getByRole("button", { name: "Add Redirection Host", exact: true }).first().click();
		await windowTitled(page, "Add Redirection Host");
		const redirection = page.getByRole("dialog");
		input = await typeDomain(redirection, "flow-zone.com");
		await page.locator(LIST_SETTLE).first().waitFor();
		await optionNamed(page, "flow-zone.com.au").first().waitFor();
		await input.press("Enter");
		await redirection.locator("[data-slot=combobox-chips]").getByText("flow-zone.com", { exact: true }).waitFor();
		const typed = await chipsOf(redirection);
		if (JSON.stringify(typed) !== JSON.stringify(["flow-zone.com"]))
			throw new Error(`Enter added ${typed}, not flow-zone.com`);
		await closeWindow(page, redirection);

		// 4. the HTTP certificate window offers no wildcard, the DNS certificate window offers it with its note
		await page.goto("/certificates");
		await page.getByRole("button", { name: "Add Certificate", exact: true }).first().click();
		await page.getByRole("menuitem", { name: "Certbot via HTTP", exact: true }).click();
		const http = page.getByRole("dialog");
		await typeDomain(http, "*");
		await settled(page);
		if ((await optionNamed(page, "*.flow-pick.example").count()) !== 0)
			throw new Error("a wildcard is offered in the HTTP certificate window");
		await closeWindow(page, http);

		await page.getByRole("button", { name: "Add Certificate", exact: true }).first().click();
		await page.getByRole("menuitem", { name: "Certbot via DNS", exact: true }).click();
		const dns = page.getByRole("dialog");
		// a name the field holds, typed again with Enter, adds nothing: not the wildcard nor a name that contains it
		input = await typeDomain(dns, "flow-pick.example");
		await input.press("Enter");
		await dns.locator("[data-slot=combobox-chips]").getByText("flow-pick.example", { exact: true }).waitFor();
		input = await typeDomain(dns, "flow-pick.example");
		await optionNamed(page, "*.flow-pick.example").first().waitFor();
		const highlighted = page.locator("[cmdk-item][aria-selected=true]");
		if ((await highlighted.count()) !== 0) throw new Error("an entry is highlighted for a name the field holds");
		await input.press("Enter");
		await settled(page);
		const again = await chipsOf(dns);
		if (JSON.stringify(again) !== JSON.stringify(["flow-pick.example"]))
			throw new Error(`Enter on a held name changed the names to ${again}`);
		// an arrow key still highlights the first entry
		input = await typeDomain(dns, "flow-pick.example");
		await optionNamed(page, "*.flow-pick.example").first().waitFor();
		await input.press("ArrowDown");
		await highlighted.first().waitFor();
		await typeDomain(dns, "*");
		await optionNamed(page, "*.flow-pick.example").filter({ hasText: "wildcard" }).first().waitFor();
		await optionNamed(page, "*.flow-pick.example").first().click();
		await dns.locator("[data-slot=combobox-chips]").getByText("*.flow-pick.example", { exact: true }).waitFor();
		// chips show Unicode, the stored name stays ASCII
		input = await typeDomain(dns, "flow-b\u00fccher.example");
		await input.press("Enter");
		await dns
			.locator("[data-slot=combobox-chips]")
			.getByText("flow-b\u00fccher.example", { exact: true })
			.waitFor();
		await closeWindow(page, dns);
		if (errors.length > 0) throw new Error(`page error: ${errors[0]}`);
	} finally {
		await cleanUp(api);
	}
}

const noteOf = (dialog, kind) => dialog.locator(`[data-dns-suggestion=${kind}]`);

async function dnsChallengeSuggestion({ admin }) {
	const { page, api, errors } = admin;
	try {
		await api("POST", "/nginx/dns-credentials", credentialBody("flow-cs-a", ["flow-cs-a.example"]));
		await api("POST", "/nginx/dns-credentials", credentialBody("flow-cs-b", ["flow-cs-b.example"]));
		const certificates = JSON.stringify((await api("GET", "/nginx/certificates")).map((row) => row.id));
		await page.goto("/certificates");
		await page.getByRole("button", { name: "Add Certificate", exact: true }).first().click();
		await page.getByRole("menuitem", { name: "Certbot via DNS", exact: true }).click();
		const dialog = page.getByRole("dialog");
		const credential = dialog.locator("#dnsCredential");
		const provider = dialog.locator("#dnsProvider");

		// 1. one credential covers the name: provider and credential are preselected, the note is a status
		await addDomain(dialog, "www.flow-cs-a.example");
		await noteOf(dialog, "suggested").waitFor();
		if ((await provider.textContent()).trim() !== "Cloudflare")
			throw new Error(`provider: ${await provider.textContent()}`);
		if (!(await credential.textContent()).includes("flow-cs-a"))
			throw new Error(`credential: ${await credential.textContent()}`);
		if ((await noteOf(dialog, "suggested").locator("xpath=ancestor::*[@role='status']").count()) === 0)
			throw new Error("the suggestion note is not a status region");

		// 2. a second name needs the other credential: nothing is preselected, the note names both
		await addDomain(dialog, "www.flow-cs-b.example");
		const spread = noteOf(dialog, "spread");
		await spread.waitFor();
		const text = await spread.textContent();
		if (!(text.includes("flow-cs-a") && text.includes("flow-cs-b"))) throw new Error(`spread note: ${text}`);
		if (
			(await dialog.locator("#dnsCredential").count()) !== 0 &&
			(await credential.textContent()).includes("flow-cs-")
		)
			throw new Error("a credential stays preselected for names on two credentials");

		// 3. a hand pick stays when the names change
		await dialog.getByRole("button", { name: "Remove www.flow-cs-b.example", exact: true }).click();
		await noteOf(dialog, "spread").waitFor({ state: "detached" });
		if ((await dialog.locator("#dnsCredential").count()) === 0) {
			await provider.click();
			await page.getByRole("option", { name: "Cloudflare", exact: true }).click();
		}
		await credential.click();
		await page.getByRole("option", { name: "flow-cs-b", exact: true }).click();
		const warn = noteOf(dialog, "not-covered");
		await warn.waitFor();
		if (!(await warn.textContent()).includes("www.flow-cs-a.example"))
			throw new Error("the warning does not name the name");
		await addDomain(dialog, "api.flow-cs-a.example");
		await noteOf(dialog, "not-covered").waitFor();
		if (!(await credential.textContent()).includes("flow-cs-b")) throw new Error("the hand pick was replaced");
		if ((await noteOf(dialog, "suggested").count()) !== 0) throw new Error("a suggestion replaced the hand pick");

		// 4. nothing was requested
		await closeWindow(page, dialog);
		if (JSON.stringify((await api("GET", "/nginx/certificates")).map((row) => row.id)) !== certificates)
			throw new Error("a certificate was created");
		if (errors.length > 0) throw new Error(`page error: ${errors[0]}`);
	} finally {
		await cleanUp(api);
	}
}

// The provider's zones in the Add domains window: the answer is made by page.route (CI never calls a provider);
// Save is a real POST.
const ZONES_ROUTE = "**/api/nginx/dns-credentials/*/provider-domains";
const ZONES = {
	supported: true,
	truncated: false,
	zones: [
		{ name: "flow-f1.example", state: "new" },
		{ name: "flow-f2.example", state: "here" },
		{ name: "flow-f3.example", state: "other", credential_name: "flow-elsewhere" },
	],
};
const ZONES_FORBIDDEN = {
	error: {
		code: 400,
		message: "The provider refused to list the zones: Authentication error",
		message_i18n: "error.dns-zones-forbidden",
		message_values: { message: "Authentication error", provider: "Cloudflare", needs: "Zone:Zone:Read" },
	},
};
const ZONES_FAILED = {
	error: {
		code: 400,
		message: "Unexpected answer (500): boom",
		message_i18n: "error.dns-zones-failed",
		message_values: { message: "Unexpected answer (500): boom" },
	},
};
const ZONES_EMPTY = { supported: true, truncated: false, zones: [] };

// the other flows open Add domains with a Cloudflare credential: no zone list is wanted, and none may reach a provider
const stubZones = (page) =>
	page.route(ZONES_ROUTE, (route) =>
		route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ZONES_EMPTY) }),
	);

const addWindow = (page) => page.locator("[data-dns-domains-window]");
const zonesState = (page, state) => page.locator(`[data-fetch-domains][data-fetch-state=${state}]`);

async function fetchDomains({ admin }) {
	const { page, api, errors } = admin;
	// the next answer of the provider route; a promise in "gate" holds it back
	let answer = { status: 200, body: ZONES };
	let gate = null;
	await page.route(ZONES_ROUTE, async (route) => {
		if (gate) await gate;
		// a request the window aborted (Cancel) cannot be answered any more
		await route
			.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) })
			.catch(() => undefined);
	});
	const posts = [];
	page.on("request", (request) => {
		if (request.method() === "POST" && new URL(request.url()).pathname === "/api/nginx/dns-domains")
			posts.push(request.postDataJSON());
	});
	// Cancel: the "Unsaved changes" question must appear exactly when the user did something that would be lost
	const cancel = async (expectQuestion = false) => {
		const ask = page.getByRole("alertdialog");
		await addWindow(page).getByRole("button", { name: "Cancel", exact: true }).click();
		if (expectQuestion) {
			await ask.getByRole("heading", { name: "Unsaved changes" }).waitFor({ timeout: 5000 });
			await ask.getByRole("button", { name: "Discard changes", exact: true }).click();
		}
		await addWindow(page).waitFor({ state: "detached" });
		if ((await ask.count()) !== 0) throw new Error("an unsaved-changes question stayed open");
	};
	const zone = (name) => addWindow(page).locator(`[id="fetch-zone-${name}"]`);
	const save = () => addWindow(page).getByRole("button", { name: "Save", exact: true });
	try {
		await api("POST", "/nginx/dns-credentials", {
			name: "flow-fetch-ini",
			provider: "acmedns",
			ini: "dns_acmedns_api_url=http://acmedns.example/",
		});
		const cf = await api("POST", "/nginx/dns-credentials", {
			name: "flow-fetch-cf",
			provider: "cloudflare",
			ini: "dns_cloudflare_api_token=flow-token",
		});

		// 1. a provider without a zone list: the row menu opens the window with the credential chosen, no zone section,
		// and the typed names work
		await page.goto("/certificates/dns-credentials");
		await rowAction(page, "flow-fetch-ini", "Add domains");
		await addWindow(page).waitFor();
		await addWindow(page).locator("#dnsCredential").getByText("flow-fetch-ini", { exact: false }).waitFor();
		if ((await page.locator("[data-fetch-domains]").count()) !== 0)
			throw new Error("a provider without a zone list shows the zone section");
		await cancel();

		// 1b. the unsaved-changes question: none for the preset credential and the auto-ticked zone, one for a tick
		// the user changed by hand
		await rowAction(page, "flow-fetch-cf", "Add domains");
		await addWindow(page).waitFor();
		await zonesState(page, "list").waitFor();
		if ((await zone("flow-f1.example").getAttribute("aria-checked")) !== "true")
			throw new Error("the new zone is not auto-ticked");
		await cancel(false);
		await rowAction(page, "flow-fetch-cf", "Add domains");
		await addWindow(page).waitFor();
		await zonesState(page, "list").waitFor();
		await zone("flow-f1.example").click();
		await cancel(true);

		// 2. loading: Cancel aborts the request in flight
		let release = () => undefined;
		gate = new Promise((resolve) => {
			release = resolve;
		});
		await rowAction(page, "flow-fetch-cf", "Add domains");
		await addWindow(page).waitFor();
		await zonesState(page, "loading").waitFor();
		const aborted = page.waitForEvent("requestfailed", {
			predicate: (request) => request.url().includes("/provider-domains"),
			timeout: 5000,
		});
		await cancel();
		await aborted.catch(() => {
			throw new Error("Cancel did not abort the provider request");
		});
		gate = null;
		release();

		// 3. the forbidden answer: the Cloudflare hint (it names the right, so the provider's own wording is not
		// repeated); the typed names can still be saved
		answer = { status: 400, body: ZONES_FORBIDDEN };
		await rowAction(page, "flow-fetch-cf", "Add domains");
		await zonesState(page, "error").waitFor();
		await addWindow(page).getByText("This token cannot list zones", { exact: false }).waitFor();
		if ((await addWindow(page).getByText("Zone:Zone:Read", { exact: false }).count()) > 0)
			throw new Error("the Cloudflare hint repeats what the token needs");
		if (!(await save().isDisabled())) throw new Error("Save is enabled with nothing typed or ticked");
		await addChip(addWindow(page), "flow-typed.example");
		await save().click();
		await addWindow(page).waitFor({ state: "detached" });
		await page.goto("/certificates/domains");
		await rowShows(page, "flow-typed.example", "flow-fetch-cf");
		const last = posts.at(-1);
		if (JSON.stringify(last.names) !== '["flow-typed.example"]' || "fetched_names" in last)
			throw new Error(`the typed save body: ${JSON.stringify(last)}`);

		// a failed list shows its message without the permission hint
		answer = { status: 400, body: ZONES_FAILED };
		await page.getByRole("button", { name: "Add domains", exact: true }).first().click();
		await addWindow(page).waitFor();
		await chooseCredential(page, addWindow(page), "flow-fetch-cf");
		await zonesState(page, "error").waitFor();
		await page.locator("[data-fetch-domains]").getByText("boom", { exact: false }).first().waitFor();
		if ((await addWindow(page).getByText("This token cannot list zones", { exact: false }).count()) > 0)
			throw new Error("a failed list shows the permission hint");
		await cancel();

		// 4. a list: the new zone is ticked, a name on another credential cannot be ticked, a zone already here has
		// no box; typed and ticked names are saved in ONE request
		answer = { status: 200, body: ZONES };
		await page.getByRole("button", { name: "Add domains", exact: true }).first().click();
		await addWindow(page).waitFor();
		if ((await page.locator("[data-fetch-domains]").count()) !== 0)
			throw new Error("the zone section shows before a credential is chosen");
		await chooseCredential(page, addWindow(page), "flow-fetch-cf");
		await zonesState(page, "list").waitFor();
		await addWindow(page).getByText("on flow-elsewhere", { exact: true }).waitFor();
		if (!(await zone("flow-f3.example").isDisabled()))
			throw new Error("a zone on another credential can be ticked");
		if ((await zone("flow-f2.example").count()) !== 0)
			throw new Error("a zone that is already here has a checkbox");
		if ((await zone("flow-f1.example").getAttribute("aria-checked")) !== "true")
			throw new Error("the new zone is not ticked");
		// no ticked zone and nothing typed: Save is off
		await zone("flow-f1.example").click();
		if (!(await save().isDisabled())) throw new Error("Save is enabled with nothing typed or ticked");
		await zone("flow-f1.example").click();
		if (await save().isDisabled()) throw new Error("Save is off with a ticked zone");
		// changing the credential drops the list and the ticks, choosing it again loads a fresh list
		await chooseCredential(page, addWindow(page), "flow-fetch-ini");
		await page.locator("[data-fetch-domains]").waitFor({ state: "detached" });
		await chooseCredential(page, addWindow(page), "flow-fetch-cf");
		await zonesState(page, "list").waitFor();
		await addChip(addWindow(page), "flow-t1.example");
		const before = posts.length;
		await save().click();
		await addWindow(page).waitFor({ state: "detached" });
		await rowShows(page, "flow-f1.example", "Fetched");
		if (posts.length !== before + 1) throw new Error(`the save made ${posts.length - before} requests`);
		const body = posts.at(-1);
		if (
			JSON.stringify(body.names) !== '["flow-t1.example"]' ||
			JSON.stringify(body.fetched_names) !== '["flow-f1.example"]'
		)
			throw new Error(`the save body: ${JSON.stringify(body)}`);
		const rows = await api("GET", "/nginx/dns-domains");
		const stored = (name) => rows.find((row) => row.name === name);
		if (stored("flow-f1.example")?.dns_credential_id !== cf.id || stored("flow-f1.example").source !== "fetched")
			throw new Error(`the stored zone: ${JSON.stringify(stored("flow-f1.example"))}`);
		if (stored("flow-t1.example")?.source !== "typed")
			throw new Error(`the stored typed name: ${JSON.stringify(stored("flow-t1.example"))}`);

		// 5. an empty list
		answer = { status: 200, body: ZONES_EMPTY };
		await page.goto("/certificates/dns-credentials");
		await rowAction(page, "flow-fetch-cf", "Add domains");
		await zonesState(page, "empty").waitFor();
		await cancel();

		// 6. a provider added with PR 7 (Porkbun): its zones come from the same route, and a refusal shows its own hint
		await api("POST", "/nginx/dns-credentials", {
			name: "flow-fetch-pork",
			provider: "porkbun",
			ini: "dns_porkbun_key=flow-key\ndns_porkbun_secret=flow-secret",
		});
		answer = { status: 200, body: ZONES };
		await page.goto("/certificates/dns-credentials");
		await rowAction(page, "flow-fetch-pork", "Add domains");
		await addWindow(page).waitFor();
		await zonesState(page, "list").waitFor();
		await zone("flow-f1.example").waitFor();
		await addWindow(page).getByText("on flow-elsewhere", { exact: true }).waitFor();
		await cancel(false);
		answer = {
			status: 400,
			body: {
				error: {
					code: 400,
					message: "The provider refused to list the zones: API access not enabled",
					message_i18n: "error.dns-zones-forbidden",
					message_values: { message: "API access not enabled", provider: "Porkbun" },
				},
			},
		};
		await rowAction(page, "flow-fetch-pork", "Add domains");
		await zonesState(page, "error").waitFor();
		await addWindow(page).getByText("Turn on API access for the domain", { exact: false }).waitFor();
		if ((await addWindow(page).getByText("This token cannot list zones", { exact: false }).count()) > 0)
			throw new Error("Porkbun shows the Cloudflare hint");
		if ((await addWindow(page).getByText("Check the credential", { exact: false }).count()) > 0)
			throw new Error("Porkbun shows the general hint");
		await cancel();
		if (errors.length > 0) throw new Error(`page error: ${errors[0]}`);
	} finally {
		await page.unroute(ZONES_ROUTE);
		await cleanUp(api);
	}
}

// The DNS check and the challenge cleanup (PR 8a): the credential Test, the cleanup window, the host DNS card and list,
// the CAA notes. CI calls no provider and no outside name: the cleanup list and the CAA answers are made by page.route,
// the Test of PowerDNS meets the blocked address 127.0.0.1, the host names are under .example.
const CHECK_HOST = "check.flow-check.example";
// the toast of Check DNS, whatever the number of names on the page
const CHECKED_TOAST = /Checked \d+ names?:/u;
const CHALLENGES_ROUTE = "**/api/nginx/dns-credentials/*/challenges";
const CAA_CHECK_ROUTE = "**/api/nginx/certificates/caa-check";
const CAA_LIST_ROUTE = "**/api/nginx/certificates/caa";
const CERTIFICATES_LIST = /\/api\/nginx\/certificates(?:\?.*)?$/u;
const CAA_NAME = "caa.flow-check.example";
const CAA_RECORD = '0 issue "other-ca.flow-check.example"';

const challengeItem = (key, name, ageSeconds, values) => ({
	key,
	name,
	id: `id-${key}`,
	values,
	age_seconds: ageSeconds,
	recent: ageSeconds !== null && ageSeconds < 600,
	preselected: ageSeconds !== null && ageSeconds > 3600,
});

const challengeAnswer = (busy) => ({
	supported: true,
	busy,
	truncated: false,
	skipped_cnames: 1,
	items: [
		challengeItem("old", "_acme-challenge.flow-check.example", 7200, ["flow-old-value"]),
		challengeItem("new", "_acme-challenge.www.flow-check.example", 120, ["flow-new-value"]),
		challengeItem("unknown", "_acme-challenge.mail.flow-check.example", null, ["flow-unknown-value"]),
	],
});

const caaAnswer = (names, state) => ({
	checked_on: new Date().toISOString(),
	names: names.map((name) => ({
		name,
		state,
		reason: state === "refused" ? "not-listed" : "none",
		found_at: state === "refused" ? "flow-check.example" : null,
		record: state === "refused" ? CAA_RECORD : null,
		error_i18n: null,
	})),
});

const menuItem = (page, name) => page.getByRole("menuitem", { name: new RegExp(`^${name}`, "u") });
const challengeBox = (dialog, key) => dialog.locator(`#dns-challenge-${key}`);
const challengesWindow = (page) => page.locator("[data-dns-challenges-window]");

async function expectTicked(dialog, expected, what) {
	for (const [key, ticked] of Object.entries(expected)) {
		// biome-ignore lint/performance/noAwaitInLoops: one box after the other
		const actual = await challengeBox(dialog, key).isChecked();
		if (actual !== ticked) throw new Error(`${what}: the box of ${key} is ${actual ? "ticked" : "not ticked"}`);
	}
}

const DELETE_BUTTON = /^Delete \d+ records?$/u;
const deleteButton = (dialog) => dialog.getByRole("button", { name: DELETE_BUTTON });

// 1 and 2: the credential Test (a blocked address, the window's Test while a field is changed) and a provider without cleanup
async function checkCredentials({ admin }) {
	const { page, api } = admin;
	try {
		await api("POST", "/nginx/dns-credentials", {
			name: "flow-check-pdns",
			provider: "powerdns",
			fields: [
				{ key: "dns_pdns_endpoint", value: "https://127.0.0.1" },
				{ key: "dns_pdns_api_key", value: "flow-key" },
			],
		});
		await api("POST", "/nginx/dns-credentials", {
			name: "flow-check-linode",
			provider: "linode",
			ini: "dns_linode_key=flow-key",
		});
		await page.goto("/certificates/dns-credentials");
		await rowShows(page, "flow-check-pdns", "PowerDNS");
		// the Test of the row menu: the loopback address is blocked
		await withToast(page, "NPMpro does not send requests to this address", () =>
			rowAction(page, "flow-check-pdns", "Test"),
		);

		// the window's Test: works while nothing is changed, is disabled with its reason once a field is changed
		await rowAction(page, "flow-check-pdns", "Edit");
		await windowTitled(page, "Edit DNS credential");
		const dialog = page.getByRole("dialog");
		const test = dialog.getByRole("button", { name: "Test", exact: true });
		await test.waitFor();
		await page.waitForFunction(() => document.querySelector("#dnsCredentialName")?.value === "flow-check-pdns");
		if (await test.isDisabled()) throw new Error("the window's Test is disabled on an unchanged credential");
		await test.click();
		await dialog.getByText("NPMpro does not send requests to this address.", { exact: true }).waitFor();
		await dialog.locator("#dnsCredentialName").fill("flow-check-pdns-changed");
		await dialog.getByText("Save the credential first", { exact: true }).waitFor();
		if (!(await test.isDisabled())) throw new Error("the window's Test is enabled while a field is changed");
		await closeWindow(page, dialog);

		// a provider with no challenge cleanup: the item is disabled and says why
		await page.goto("/certificates/dns-credentials");
		await revealMenu(page, "flow-check-linode");
		const cleanup = menuItem(page, "Clean up challenge records");
		await cleanup.waitFor();
		if ((await cleanup.getAttribute("aria-disabled")) !== "true")
			throw new Error("Clean up challenge records is enabled for Linode");
		await cleanup.getByText("NPMpro cannot clean up challenge records at this provider", { exact: true }).waitFor();
		await page.keyboard.press("Escape");
		await page.getByRole("menu").waitFor({ state: "detached" });
	} finally {
		await cleanUp(api);
	}
}

async function revealMenu(page, name) {
	await rowShows(page, name, name);
	await page
		.getByRole("button", { name: `Actions for ${name}`, exact: true })
		.filter({ visible: true })
		.click();
}

// 3: the cleanup window with routed answers
async function checkCleanup({ admin }) {
	const { page, api } = admin;
	let busy = false;
	const deletes = [];
	await page.route(CHALLENGES_ROUTE, (route) =>
		route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(challengeAnswer(busy)) }),
	);
	page.on("request", (request) => {
		if (request.method() === "POST" && request.url().includes("/challenges/delete")) deletes.push(request.url());
	});
	try {
		await api("POST", "/nginx/dns-credentials", {
			name: "flow-check-cf",
			provider: "cloudflare",
			ini: "dns_cloudflare_api_token=flow-token",
			domains: ["flow-check.example"],
		});
		const open = async () => {
			await page.goto("/certificates/dns-credentials");
			await rowAction(page, "flow-check-cf", "Clean up challenge records");
			await challengesWindow(page).waitFor();
			await challengeBox(page.getByRole("dialog"), "old").waitFor();
			return page.getByRole("dialog");
		};

		// only the old record is ticked; the unknown age says so; the skipped CNAME is noted
		let dialog = await open();
		await expectTicked(dialog, { old: true, new: false, unknown: false }, "the preselection");
		await dialog.locator("[data-challenge-unknown-age]").waitFor();
		await dialog.getByText("1 CNAME delegation at _acme-challenge is not touched.", { exact: true }).waitFor();
		if ((await dialog.getByText("Recent", { exact: true }).count()) !== 1)
			throw new Error("one record is not marked Recent");

		// Select all ticks every record (none is in use), a second click clears them
		const all = dialog.locator("#dns-challenges-all");
		await all.click();
		await expectTicked(dialog, { old: true, new: true, unknown: true }, "Select all");
		await deleteButton(dialog).filter({ hasText: "Delete 3 records" }).waitFor();
		await all.click();
		await expectTicked(dialog, { old: false, new: false, unknown: false }, "Select all cleared");
		if (!(await deleteButton(dialog).isDisabled())) throw new Error("Delete is enabled with nothing ticked");
		await challengeBox(dialog, "old").click();

		// Delete asks the question and sends nothing; Back returns to the list
		await deleteButton(dialog).filter({ hasText: "Delete 1 record" }).click();
		await dialog.locator("[data-challenge-confirm]").waitFor();
		await dialog.getByText("Delete 1 record at flow-check-cf?", { exact: true }).waitFor();
		if (deletes.length > 0) throw new Error("a delete was sent before the confirmation");
		await dialog.getByRole("button", { name: "Back", exact: true }).click();
		await expectTicked(dialog, { old: true, new: false, unknown: false }, "after Back");

		// Cancel deletes nothing and the list is the same when the window is opened again
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		await windowClosed(page);
		dialog = await open();
		await expectTicked(dialog, { old: true, new: false, unknown: false }, "the reopened list");
		if (deletes.length > 0) throw new Error("Cancel sent a delete");
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		await windowClosed(page);

		// a certificate request runs: the banner, boxes and Delete are disabled, nothing is ticked
		busy = true;
		dialog = await open();
		await dialog.locator("[data-challenge-busy]").waitFor();
		await expectTicked(dialog, { old: false, new: false, unknown: false }, "the busy list");
		if (!(await challengeBox(dialog, "old").isDisabled())) throw new Error("a box is enabled while a request runs");
		if (!(await dialog.locator("#dns-challenges-all").isDisabled()))
			throw new Error("Select all is enabled while a request runs");
		if (!(await deleteButton(dialog).isDisabled())) throw new Error("Delete is enabled while a request runs");
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		await windowClosed(page);
		if (deletes.length > 0) throw new Error("a delete was sent");
	} finally {
		await page.unroute(CHALLENGES_ROUTE);
		await cleanUp(api);
	}
}

// 4: the DNS card of a host window, the badge and Check DNS in the list, and the View window of a limited user
async function checkHost({ admin, browser, base, viewerPassword }) {
	const { page, api } = admin;
	try {
		const created = await api("POST", "/nginx/proxy-hosts", {
			domain_names: [CHECK_HOST],
			forward_scheme: "http",
			forward_host: "127.0.0.1",
			forward_port: 8080,
		});
		await page.goto("/nginx/proxy");
		await rowAction(page, CHECK_HOST, "Edit");
		await windowTitled(page, "Edit Proxy Host");
		let dialog = page.getByRole("dialog");
		const line = dialog.locator(`[data-dns-name="${CHECK_HOST}"]`);
		await line.waitFor();
		await dialog.getByText("Not checked yet", { exact: true }).waitFor();
		await dialog.locator("[data-dns-check-button]").click();
		const state = line.locator("[data-dns-state]");
		await state.waitFor();
		const result = await state.getAttribute("data-dns-state");
		if (!["here", "partly", "elsewhere", "none", "unknown"].includes(result))
			throw new Error(`the check line shows ${result}`);
		console.log(`dns check: ${CHECK_HOST} is ${result}`);
		await closeWindow(page, dialog);
		// the list shows the badge of the result in the host's own row (other hosts may be on the page too; a row holds a
		// second, hidden copy of its cells for the phone layout, so the visible one is waited for)
		await revealRow(page, CHECK_HOST);
		await rowOf(page, CHECK_HOST).locator("[data-dns-check]").filter({ visible: true }).first().waitFor();
		// Check DNS on the list checks the page (with any other host on it) and says so; the request holds this host
		const host = created.id;
		const sent = page.waitForRequest(
			(request) =>
				request.method() === "POST" &&
				request.url().endsWith("/api/nginx/dns-check/hosts") &&
				(request.postDataJSON()?.hosts ?? []).some((one) => one.type === "proxy" && one.id === host),
		);
		await withToast(page, CHECKED_TOAST, () =>
			page.locator("[data-dns-check-page]").filter({ visible: true }).first().click(),
		);
		await sent;
		await rowOf(page, CHECK_HOST).locator("[data-dns-check]").filter({ visible: true }).first().waitFor();

		// a limited user: the fields stay disabled, Check works, there is no Save
		const viewer = await signIn(browser, base, VIEWER_EMAIL, viewerPassword);
		try {
			await viewer.page.goto("/nginx/proxy");
			await rowAction(viewer.page, CHECK_HOST, "View");
			await windowTitled(viewer.page, "View Proxy Host");
			dialog = viewer.page.getByRole("dialog");
			const check = dialog.locator("[data-dns-check-button]");
			await check.waitFor();
			if (await check.isDisabled()) throw new Error("Check is disabled in the View window");
			if ((await dialog.getByRole("button", { name: "Save" }).count()) !== 0)
				throw new Error("the View window can save");
			const enabled = await dialog.evaluate((root) =>
				[...root.querySelectorAll("input, select, textarea, [role=switch], [role=combobox], [role=checkbox]")]
					.filter(
						(el) =>
							el.type !== "hidden" &&
							el.getClientRects().length > 0 &&
							!(el.disabled || el.closest("fieldset:disabled") || el.readOnly) &&
							el.getAttribute("aria-readonly") !== "true" &&
							el.getAttribute("aria-disabled") !== "true",
					)
					.map((el) => `${el.tagName.toLowerCase()}#${el.id}`),
			);
			if (enabled.length > 0) throw new Error(`enabled fields in the View window: ${enabled.join(", ")}`);
			await check.click();
			await dialog.locator(`[data-dns-name="${CHECK_HOST}"] [data-dns-state]`).waitFor();
			await viewer.page.keyboard.press("Escape");
			await windowClosed(viewer.page);
			if (viewer.errors.length > 0) throw new Error(`page error for the viewer: ${viewer.errors[0]}`);
		} finally {
			await viewer.context.close();
		}
	} finally {
		await cleanUp(api);
	}
}

// 5: the CAA note of the DNS certificate window and the badge of the certificate list, with routed answers
async function checkCaa({ admin }) {
	const { page, api } = admin;
	let state = "refused";
	await page.route(CAA_CHECK_ROUTE, (route) => {
		const names = route.request().postDataJSON().domain_names;
		return route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(caaAnswer(names, state)),
		});
	});
	try {
		await page.goto("/certificates");
		await page.getByRole("button", { name: "Add Certificate", exact: true }).first().click();
		await page.getByRole("menuitem", { name: "Certbot via DNS", exact: true }).click();
		const dialog = page.getByRole("dialog");
		await dialog.locator("#domainNames").waitFor();
		await addDomain(dialog, "caa.flow-check.example");
		const note = dialog.locator("[data-caa=refused]");
		await note.waitFor();
		const text = await note.textContent();
		if (!(text.includes(CAA_RECORD) && text.includes("flow-check.example")))
			throw new Error(`the refused note does not name the record: ${text}`);
		// an answer that allows the names: the note goes
		state = "allowed";
		await addDomain(dialog, "caa2.flow-check.example");
		await dialog.locator("[data-caa]").waitFor({ state: "detached" });
		await closeWindow(page, dialog);

		// the list: a Let's Encrypt certificate with a refused cached entry shows the icon
		const certificate = await uploadCertificate(api, "flow-check-caa");
		await page.route(CERTIFICATES_LIST, async (route) => {
			if (route.request().method() !== "GET") return route.fallback();
			const answer = await route.fetch();
			const rows = await answer.json();
			for (const row of rows) {
				if (row.nice_name === "flow-check-caa")
					Object.assign(row, { provider: "letsencrypt", domain_names: [CAA_NAME] });
			}
			return route.fulfill({ response: answer, json: rows });
		});
		await page.route(CAA_LIST_ROUTE, (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify([
					{
						certificate_id: certificate.id,
						state: "refused",
						checked_on: new Date().toISOString(),
						names: caaAnswer(["caa.flow-check.example"], "refused").names,
					},
				]),
			}),
		);
		await page.goto("/certificates");
		await rowShows(page, CAA_NAME, CAA_NAME);
		await page
			.locator("tbody tr")
			.filter({ hasText: CAA_NAME })
			.locator("[data-caa=refused]")
			.filter({ visible: true })
			.first()
			.waitFor();
	} finally {
		await page.unroute(CAA_CHECK_ROUTE);
		await page.unroute(CAA_LIST_ROUTE);
		await page.unroute(CERTIFICATES_LIST);
		await cleanUp(api);
	}
}

// the four parts one after the other on the admin session; each removes what it made
async function dnsCheck(env) {
	await checkCredentials(env);
	await checkCleanup(env);
	await checkHost(env);
	await checkCaa(env);
}

export const dnsFlows = [
	{ name: "dns domains", run: dnsDomains },
	{ name: "domain picker", run: domainPicker },
	{ name: "dns challenge suggestion", run: dnsChallengeSuggestion },
	{ name: "fetch domains", run: fetchDomains },
	{ name: "dns check", run: dnsCheck },
];
