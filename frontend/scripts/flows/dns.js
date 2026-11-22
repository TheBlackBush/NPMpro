// The Domains of DNS credentials: the credential window's Domains line and list column, the Domains tab, Add domains
// with a name the owner keeps on another credential, Edit (move), Delete, the unsaved-changes question and the
// view-only tab. The flows create their data as flow-... and remove it.
import {
	cleanUp,
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

export const dnsFlows = [{ name: "dns domains", run: dnsDomains }];
