import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

// every signed-in page has one top heading: PageHeader's h1 (the old card titles became it)
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const LAZY_PAGE = /^const (?<name>[A-Za-z]+) = lazy\(/gmu;
const PAGE_HEADER = /<PageHeader\b/gu;
const H1 = /<h1\b/gu;
const OLD_CARD_TITLE = /card-title fs-2/u;
const TITLE_H1 = /<h1[^>]*>\s*\{title\}\s*<\/h1>/u;
const NOT_FOUND_TITLE = /const Title = page \? "h1" : "p";/u;
const byName = (a, b) => a.localeCompare(b);
const NOT_FOUND_ROUTE = /<Route path="\*" element=\{<ErrorNotFound page \/>\} \/>/u;

// the file of each routed page that renders its header (the list pages: their TableWrapper, which has the actions)
const HEADER_OF = {
	Dashboard: "pages/Dashboard/index.jsx",
	Settings: "pages/Settings/index.jsx",
	Certificates: "pages/Certificates/TableWrapper.jsx",
	DnsCredentials: "pages/Certificates/DnsCredentials/TableWrapper.jsx",
	Access: "pages/Access/TableWrapper.jsx",
	AuditLog: "pages/AuditLog/TableWrapper.jsx",
	Users: "pages/Users/TableWrapper.jsx",
	Monitoring: "pages/Monitoring/index.jsx",
	ProxyHosts: "pages/Nginx/ProxyHosts/TableWrapper.jsx",
	RedirectionHosts: "pages/Nginx/RedirectionHosts/TableWrapper.jsx",
	DeadHosts: "pages/Nginx/DeadHosts/TableWrapper.jsx",
	Streams: "pages/Nginx/Streams/TableWrapper.jsx",
};
// signed out: their own layout until 26.6
const SIGNED_OUT = ["Setup", "Login"];

it("PageHeader renders the page's title as the h1", () => {
	const source = read("components/PageHeader.jsx");
	assert.equal(source.match(H1)?.length, 1);
	assert.match(source, TITLE_H1);
});

it("every routed page renders one PageHeader and no h1 or old card title of its own", () => {
	const pages = [...read("Router.jsx").matchAll(LAZY_PAGE)].map((match) => match.groups.name);
	assert.deepEqual(
		pages.filter((name) => !SIGNED_OUT.includes(name)).sort(byName),
		Object.keys(HEADER_OF).sort(byName),
	);
	for (const [name, path] of Object.entries(HEADER_OF)) {
		const source = read(path);
		assert.equal(source.match(PAGE_HEADER)?.length, 1, `${name}: one PageHeader in ${path}`);
		assert.equal(source.match(H1), null, `${name}: no h1 of its own`);
		assert.doesNotMatch(source, OLD_CARD_TITLE, `${name}: the card title became the PageHeader`);
	}
});

it("the not-found route is a page with its own h1; inside Settings or Monitoring it stays a paragraph", () => {
	assert.match(read("Router.jsx"), NOT_FOUND_ROUTE);
	const source = read("components/ErrorNotFound.jsx");
	assert.match(source, NOT_FOUND_TITLE);
});
