import assert from "node:assert/strict";
import { it } from "node:test";
import { cleanPath, MAX_PATH } from "../lib/traffic/clean-path.js";

const JWT =
	"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkphbmUifQ.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

it("keeps a plain path and makes an empty one /", () => {
	assert.equal(cleanPath("/wp-login.php"), "/wp-login.php");
	assert.equal(cleanPath("/.env"), "/.env");
	assert.equal(cleanPath("/robots.txt"), "/robots.txt");
	assert.equal(cleanPath(""), "/");
	assert.equal(cleanPath("//"), "/");
	assert.equal(cleanPath(undefined), "/");
});

it("decodes once and collapses repeated slashes, also decoded ones", () => {
	assert.equal(cleanPath("/a%2Fb"), "/a/b");
	assert.equal(cleanPath("/a%2F%2Fb//c"), "/a/b/c");
	// decoded once only: %25 becomes a literal percent sign
	assert.equal(cleanPath("/%2541"), "/%41");
	assert.equal(cleanPath("///etc/passwd"), "/etc/passwd");
});

it("decodes UTF-8 and keeps invalid escapes as they were", () => {
	assert.equal(cleanPath("/caf%C3%A9"), "/café");
	assert.equal(cleanPath("/%E2%9C%93"), "/✓");
	assert.equal(cleanPath("/%F0%9F%98%80"), "/😀");
	assert.equal(cleanPath("/a%zz"), "/a%zz");
	assert.equal(cleanPath("/a%C3"), "/a%C3");
	assert.equal(cleanPath("/%c3%a9%FF"), "/é%FF");
	// an encoded surrogate is not valid UTF-8
	assert.equal(cleanPath("/%ED%A0%80"), "/%ED%A0%80");
});

it("keeps spaces, control, format and separator characters encoded", () => {
	assert.equal(cleanPath("/a%20b"), "/a%20b");
	assert.equal(cleanPath("/x%20"), "/x%20");
	assert.equal(cleanPath("/%00x"), "/%00x");
	assert.equal(cleanPath("/x%0d%0a"), "/x%0D%0A");
	assert.equal(cleanPath("/%7F"), "/%7F");
	// C1 control, no-break space, bidi override, zero width space and joiner, BOM, line separator
	assert.equal(cleanPath("/%C2%85"), "/%C2%85");
	assert.equal(cleanPath("/x%C2%A0"), "/x%C2%A0");
	assert.equal(cleanPath("/%E2%80%AEfdp.exe"), "/%E2%80%AEfdp.exe");
	assert.equal(cleanPath("/a%E2%80%8Bb%E2%80%8Dc"), "/a%E2%80%8Bb%E2%80%8Dc");
	assert.equal(cleanPath("/%EF%BB%BFx%E2%80%A8"), "/%EF%BB%BFx%E2%80%A8");
});

it("keeps ? # and ; encoded, so a stored path never looks like it has a query string", () => {
	assert.equal(cleanPath("/a%3Ftoken=x"), "/a%3Ftoken=x");
	assert.equal(cleanPath("/a%23b%3Bc"), "/a%23b%3Bc");
});

it("replaces ID and token segments with :id", () => {
	assert.equal(cleanPath("/user/1234/profile"), "/user/:id/profile");
	assert.equal(cleanPath("/item/123"), "/item/123");
	assert.equal(cleanPath("/o/550e8400-E29B-41d4-a716-446655440000"), "/o/:id");
	assert.equal(cleanPath("/t/0123456789abcdef"), "/t/:id");
	assert.equal(cleanPath("/t/0a1b2c3d4e5f6a7"), "/t/0a1b2c3d4e5f6a7");
	assert.equal(cleanPath("/r/aZ3_kQ9-LmP0xYt2"), "/r/:id");
	assert.equal(cleanPath("/privacy-policy-and-terms"), "/privacy-policy-and-terms");
	assert.equal(cleanPath("/a%2F12345"), "/a/:id");
});

it("replaces JWTs, dotted and base64 tokens, tokens with an extension and long digit runs", () => {
	assert.equal(cleanPath(`/verify/${JWT}`), "/verify/:id");
	assert.equal(cleanPath("/dl/a1B2c3D4e5F6g7H8~x"), "/dl/:id");
	assert.equal(cleanPath("/r/AbC+dEf12345GhIj=="), "/r/:id");
	assert.equal(cleanPath("/files/3f9a8c2e7b1d4a6f9e0c.pdf"), "/files/:id.pdf");
	assert.equal(cleanPath("/files/1234.png"), "/files/:id.png");
	assert.equal(cleanPath("/order-123456789"), "/order-:id");
	assert.equal(cleanPath("/invoice/no-000123"), "/invoice/no-:id");
	// 4 and 5 digit runs (years, ports, short numbers) stay
	assert.equal(cleanPath("/report-2026/v12345"), "/report-2026/v12345");
	// 16 or more token characters with a digit and a letter are a token, also a slug with a year
	assert.equal(cleanPath("/annual-report-2026"), "/:id");
	// short dotted names stay
	assert.equal(cleanPath("/s/abc.def.ghi"), "/s/abc.def.ghi");
	assert.equal(cleanPath("/wp-content/plugins/x.php"), "/wp-content/plugins/x.php");
});

it("replaces tokens next to other characters inside a segment", () => {
	assert.equal(cleanPath("/t/a1b2c3d4e5f6a7b8c9!"), "/t/:id!");
	assert.equal(cleanPath("/t/0123456789abcdef%20"), "/t/:id%20");
	assert.equal(cleanPath("/p/abc:12345678901234567xyz"), "/p/abc::id");
	assert.equal(cleanPath("/f/(x)3f9a8c2e7b1d4a6f9e0c.pdf"), "/f/(x):id.pdf");
	// 16 or more token characters without a digit stay
	assert.equal(cleanPath("/p/(privacy-policy-and-terms)"), "/p/(privacy-policy-and-terms)");
});

it("replaces email addresses with :email, also encoded ones", () => {
	assert.equal(cleanPath("/unsubscribe/jane.doe@example.com"), "/unsubscribe/:email");
	assert.equal(cleanPath("/u/jane%40example.com/x"), "/u/:email/x");
	assert.equal(cleanPath("/a@b"), "/a@b");
});

it("keeps only the path of an absolute-form target and other targets as text", () => {
	assert.equal(cleanPath("http://evil.test/x"), "/x");
	assert.equal(cleanPath("https://evil.test"), "/");
	assert.equal(cleanPath("*"), "*");
	assert.equal(cleanPath("/a\\x22b"), "/a\\x22b");
});

it("cuts at 200 characters without a broken surrogate or escape", () => {
	assert.equal(MAX_PATH, 200);
	assert.equal(cleanPath(`/${"z".repeat(250)}`).length, 200);
	const emoji = cleanPath(`/${"z".repeat(198)}%F0%9F%98%80`);
	assert.equal(emoji, `/${"z".repeat(198)}`);
	assert.ok(emoji.isWellFormed());
	assert.equal(cleanPath(`/${"z".repeat(197)}%20`), `/${"z".repeat(197)}`);
	assert.equal(cleanPath(`/${"z".repeat(198)}%2`), `/${"z".repeat(198)}`);
	// a path that was not cut keeps a trailing percent sign (an escaped %25 decodes to it)
	assert.equal(cleanPath("/a%25"), "/a%");
	assert.equal(cleanPath("/a%2"), "/a%2");
});
