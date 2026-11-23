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
	rowShows,
	saveWindow,
	signIn,
	VIEWER_EMAIL,
	windowClosed,
	windowTitled,
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

// Fetch domains: the provider's answer is made by page.route (CI never calls a provider); Add is a real POST.
const FETCH_ITEM = /^Fetch domains/u;
const FETCH_ROUTE = "**/api/nginx/dns-credentials/*/provider-domains";
const FETCH_ZONES = {
	supported: true,
	truncated: false,
	zones: [
		{ name: "flow-f1.example", state: "new" },
		{ name: "flow-f2.example", state: "here" },
		{ name: "flow-f3.example", state: "other", credential_name: "flow-elsewhere" },
	],
};
const FETCH_FORBIDDEN = {
	error: {
		code: 400,
		message: "The provider refused to list the zones: Authentication error",
		message_i18n: "error.dns-zones-forbidden",
		message_values: { message: "Authentication error", provider: "Cloudflare", needs: "Zone:Zone:Read" },
	},
};

const fetchWindow = (page) => page.locator("[data-fetch-domains-window]");
const fetchState = (page, state) => page.locator(`[data-fetch-domains][data-fetch-state=${state}]`);

async function fetchDomains({ admin }) {
	const { page, api, errors } = admin;
	// the next answer of the provider route; a promise in "gate" holds it back
	let answer = { status: 200, body: FETCH_ZONES };
	let gate = null;
	await page.route(FETCH_ROUTE, async (route) => {
		if (gate) await gate;
		await route.fulfill({
			status: answer.status,
			contentType: "application/json",
			body: JSON.stringify(answer.body),
		});
	});
	const cancel = async () => {
		await fetchWindow(page).getByRole("button", { name: "Cancel", exact: true }).click();
		await fetchWindow(page).waitFor({ state: "detached" });
	};
	try {
		const ini = await api("POST", "/nginx/dns-credentials", {
			name: "flow-fetch-ini",
			provider: "acmedns",
			ini: "dns_acmedns_api_url=http://acmedns.example/",
		});
		const cf = await api("POST", "/nginx/dns-credentials", {
			name: "flow-fetch-cf",
			provider: "cloudflare",
			ini: "dns_cloudflare_api_token=flow-token",
		});

		// 1. a provider without a zone list: the menu item is disabled and says why
		await page.goto("/certificates/dns-credentials");
		await revealRow(page, "flow-fetch-ini");
		await page
			.getByRole("button", { name: "Actions for flow-fetch-ini", exact: true })
			.filter({ visible: true })
			.click();
		const item = page.getByRole("menuitem", { name: FETCH_ITEM });
		await item.waitFor();
		if (
			(await item.getAttribute("aria-disabled")) !== "true" &&
			(await item.getAttribute("data-disabled")) === null
		)
			throw new Error("the Fetch domains item of a provider without a list is not disabled");
		await item.getByText("This provider has no zone list", { exact: false }).waitFor();
		await page.keyboard.press("Escape");
		await item.waitFor({ state: "detached" });

		// 2. loading: Cancel closes the window while the provider has not answered
		let release = () => undefined;
		gate = new Promise((resolve) => {
			release = resolve;
		});
		await rowAction(page, "flow-fetch-cf", "Fetch domains");
		await fetchWindow(page).waitFor();
		await fetchState(page, "loading").waitFor();
		await cancel();
		gate = null;
		release();

		// 3. the forbidden answer: the Cloudflare hint (it names the right, so the provider's own wording is not
		// repeated), Cancel closes, a failed fetch never blocks typing the domains
		answer = { status: 400, body: FETCH_FORBIDDEN };
		await rowAction(page, "flow-fetch-cf", "Fetch domains");
		await fetchState(page, "error").waitFor();
		await fetchWindow(page).getByText("This token cannot list zones", { exact: false }).waitFor();
		if ((await fetchWindow(page).getByText("Zone:Zone:Read", { exact: false }).count()) > 0)
			throw new Error("the Cloudflare hint repeats what the token needs");
		await cancel();
		await page.goto("/certificates/domains");
		await page.getByRole("button", { name: "Add domains", exact: true }).first().click();
		const add = page.locator("[data-dns-domains-window]");
		await add.waitFor();
		await chooseCredential(page, add, "flow-fetch-cf");
		await addChip(add, "flow-typed.example");
		await add.getByRole("button", { name: "Save", exact: true }).click();
		await add.waitFor({ state: "detached" });
		await rowShows(page, "flow-typed.example", "flow-fetch-cf");

		// 4. a list from the Domains tab: the new zone is ticked, a name on another credential cannot be ticked, the
		// button counts and is disabled at 0
		answer = { status: 200, body: FETCH_ZONES };
		await page
			.getByRole("button", { name: "Fetch domains", exact: true })
			.filter({ visible: true })
			.first()
			.click();
		await fetchWindow(page).waitFor();
		await fetchState(page, "idle").waitFor();
		await chooseCredential(page, fetchWindow(page), "flow-fetch-cf");
		await fetchState(page, "list").waitFor();
		const zone = (name) => fetchWindow(page).locator(`[id="fetch-zone-${name}"]`);
		await fetchWindow(page).getByText("on flow-elsewhere", { exact: true }).waitFor();
		if (!(await zone("flow-f3.example").isDisabled()))
			throw new Error("a zone on another credential can be ticked");
		if ((await zone("flow-f2.example").count()) !== 0)
			throw new Error("a zone that is already here has a checkbox");
		if ((await zone("flow-f1.example").getAttribute("aria-checked")) !== "true")
			throw new Error("the new zone is not ticked");
		const addButton = (text) => fetchWindow(page).getByRole("button", { name: text, exact: true });
		await addButton("Add 1 domain").waitFor();
		await zone("flow-f1.example").click();
		await addButton("Add 0 domains").waitFor();
		if (!(await addButton("Add 0 domains").isDisabled())) throw new Error("Add is enabled at 0 domains");
		await zone("flow-f1.example").click();
		await addButton("Add 1 domain").waitFor();

		// 5. Add posts the ticked name as fetched
		await addButton("Add 1 domain").click();
		await fetchWindow(page).waitFor({ state: "detached" });
		await rowShows(page, "flow-f1.example", "Fetched");
		const stored = (await api("GET", "/nginx/dns-domains")).find((row) => row.name === "flow-f1.example");
		if (stored?.dns_credential_id !== cf.id || stored.source !== "fetched")
			throw new Error(`the stored row: ${JSON.stringify(stored)}`);

		// 6. an empty list
		answer = { status: 200, body: { supported: true, truncated: false, zones: [] } };
		await page.goto("/certificates/dns-credentials");
		await rowAction(page, "flow-fetch-cf", "Fetch domains");
		await fetchState(page, "empty").waitFor();
		await cancel();
		if (ini.id === cf.id) throw new Error("the two credentials are one");
		if (errors.length > 0) throw new Error(`page error: ${errors[0]}`);
	} finally {
		await page.unroute(FETCH_ROUTE);
		await cleanUp(api);
	}
}

export const dnsFlows = [
	{ name: "dns domains", run: dnsDomains },
	{ name: "domain picker", run: domainPicker },
	{ name: "dns challenge suggestion", run: dnsChallengeSuggestion },
	{ name: "fetch domains", run: fetchDomains },
];
