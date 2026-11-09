import assert from "node:assert/strict";
import { it } from "node:test";

// What the queries of the host types and the lists answer on each database engine, through the real API. Runs on
// SQLite (api-host-queries.test.js), Postgres and MySQL (servers-*.test.js). Pass the live values through ctx.
const PROXY = "/nginx/proxy-hosts";
const DEAD = "/nginx/dead-hosts";
const STREAM = "/nginx/streams";

let counter = 0;
const proxy = (domain_names, overrides = {}) => ({
	domain_names,
	forward_scheme: "http",
	forward_host: "10.0.0.1",
	forward_port: 80,
	...overrides,
});
const ok = (answer) => {
	assert.equal(answer.status < 300, true, answer.text);
	return answer.body;
};
const refused = (answer, name) => {
	assert.equal(answer.status, 400, answer.text);
	assert.equal(answer.body.error.message, `${name} is already in use`);
};

const hostQueryTests = (ctx) => {
	it("refuses a name in another case, stored or sent", async () => {
		ok(await ctx.admin.post(PROXY, proxy(["Used.Example.com"])));
		refused(await ctx.admin.post(PROXY, proxy(["used.example.COM"])), "used.example.COM");
		ok(await ctx.admin.post(PROXY, proxy(["lower.example.com"])));
		refused(await ctx.admin.post(DEAD, { domain_names: ["LOWER.EXAMPLE.COM"] }), "LOWER.EXAMPLE.COM");
	});

	it("treats a LIKE wildcard in a name as a plain character", async () => {
		ok(await ctx.admin.post(PROXY, proxy(["a_b.example.com"])));
		ok(await ctx.admin.post(PROXY, proxy(["axb.example.com"])));
		refused(await ctx.admin.post(PROXY, proxy(["A_B.example.com"])), "A_B.example.com");
		ok(await ctx.admin.post(PROXY, proxy(["pct%x.example.com"])));
		ok(await ctx.admin.post(PROXY, proxy(["pctzzx.example.com"])));
		refused(await ctx.admin.post(PROXY, proxy(["pct%x.example.com"])), "pct%x.example.com");
	});

	it("does not take a name that only contains another one", async () => {
		ok(await ctx.admin.post(PROXY, proxy(["part.example.com"])));
		ok(await ctx.admin.post(PROXY, proxy(["apart.example.com"])));
		ok(await ctx.admin.post(PROXY, proxy(["*.wild.example.com"])));
		ok(await ctx.admin.post(PROXY, proxy(["x.wild.example.com"])));
		refused(await ctx.admin.post(PROXY, proxy(["*.wild.example.com"])), "*.wild.example.com");
	});

	it("treats a Unicode name and its punycode form as one name, in any case", async () => {
		ok(await ctx.admin.post(PROXY, proxy(["münchen.example.com"])));
		refused(await ctx.admin.post(PROXY, proxy(["xn--mnchen-3ya.example.com"])), "xn--mnchen-3ya.example.com");
		refused(await ctx.admin.post(PROXY, proxy(["MÜNCHEN.example.com"])), "MÜNCHEN.example.com");
	});

	it("names the first taken name in the order sent, and a disabled host takes none", async () => {
		ok(await ctx.admin.post(PROXY, proxy(["first.example.com"])));
		ok(await ctx.admin.post(PROXY, proxy(["second.example.com"])));
		refused(
			await ctx.admin.post(PROXY, proxy(["free.example.com", "second.example.com", "first.example.com"])),
			"second.example.com",
		);
		const off = ok(await ctx.admin.post(PROXY, proxy(["off.example.com"])));
		ok(await ctx.admin.post(`${PROXY}/${off.id}/disable`));
		ok(await ctx.admin.post(PROXY, proxy(["off.example.com"])));
	});

	it("does not find a stored regular expression name with a backslash, as JSON doubles it", async () => {
		ok(await ctx.admin.post(PROXY, proxy(["~^rx1\\.example\\.com$"])));
		ok(await ctx.admin.post(PROXY, proxy(["~^rx1\\.example\\.com$"])));
	});

	it("finds a stored regular expression name without a backslash", async () => {
		ok(await ctx.admin.post(PROXY, proxy(["~^rx2-[a-z]+$"])));
		refused(await ctx.admin.post(PROXY, proxy(["~^rx2-[a-z]+$"])), "~^rx2-[a-z]+$");
	});

	it("reads each host table once for all names of a save", async () => {
		const seen = [];
		const count = ({ sql }) => {
			if (/like/iu.test(sql)) seen.push(sql);
		};
		ctx.api.db.on("query", count);
		const names = Array.from({ length: 5 }, (_, n) => `count${n}.example.com`);
		ok(await ctx.admin.post(PROXY, proxy(names)));
		ctx.api.db.removeListener("query", count);
		assert.equal(seen.length, 3);
	});

	it("searches and sorts the list of each host type", async () => {
		ok(await ctx.admin.post(PROXY, proxy(["search-b.example.com"])));
		ok(await ctx.admin.post(PROXY, proxy(["search-a.example.com"])));
		const found = ok(await ctx.admin.get(`${PROXY}?query=search-`));
		assert.deepEqual(
			found.map((host) => host.domain_names[0]),
			["search-a.example.com", "search-b.example.com"],
		);
		assert.ok(found.every((host) => Array.isArray(host.locations) && Array.isArray(host.access_lists)));
		ok(await ctx.admin.post(DEAD, { domain_names: ["dead-search.example.com"] }));
		assert.equal(ok(await ctx.admin.get(`${DEAD}?query=dead-search`)).length, 1);
		counter += 1;
		const port = String(9300 + counter);
		ok(
			await ctx.admin.post(STREAM, {
				incoming_port: port,
				forwarding_host: "10.0.0.9",
				forwarding_port: "22",
				tcp_forwarding: true,
			}),
		);
		assert.equal(ok(await ctx.admin.get(`${STREAM}?query=${port}`)).length, 1);
	});

	it("counts the hosts of an access list and reads it back", async () => {
		const list = ok(
			await ctx.admin.post("/nginx/access-lists", {
				name: "engines",
				items: [{ username: "bob", password: "bobs-password-1" }],
				clients: [{ address: "10.1.0.0/16", directive: "allow" }],
			}),
		);
		ok(
			await ctx.admin.post(
				PROXY,
				proxy(["acl.example.com"], { npmpro_access_list_type: "custom", npmpro_access_list_ids: [list.id] }),
			),
		);
		const row = ok(await ctx.admin.get("/nginx/access-lists")).find(({ id }) => id === list.id);
		assert.equal(Number(row.proxy_host_count), 1);
	});

	it("searches the audit log and gives the report counts", async () => {
		ok(await ctx.admin.post(PROXY, proxy(["audit-search.example.com"])));
		const rows = ok(await ctx.admin.get("/audit-log?query=audit-search"));
		assert.ok(rows.length >= 1);
		const report = ok(await ctx.admin.get("/reports/hosts"));
		assert.ok(Number(report.proxy) >= 1);
		assert.equal(Number(report.errors.proxy), 0);
	});
};

export { hostQueryTests };
