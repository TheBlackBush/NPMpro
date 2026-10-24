import assert from "node:assert/strict";
import { it } from "node:test";
import { createCounter } from "../lib/traffic/counter.js";

const t = Date.UTC(2026, 9, 24, 8, 15, 30);
const e = (host, ip, status = 200, bytes = 10, time = t) => ({ time, host, ip, status, bytes });

it("aggregates per minute, host and status class", () => {
	const c = createCounter({});
	c.add(e("a", "1.1.1.1"), null, { showIps: false });
	c.add(e("a", "1.1.1.2", 200, 5), null, { showIps: false });
	c.add(e("a", "1.1.1.1", 500), null, { showIps: false });
	const { minutes, ips } = c.drain();
	const minute = Math.floor(t / 60000);
	assert.deepEqual(
		minutes.sort((x, y) => x.status_class.localeCompare(y.status_class)),
		[
			{ bucket: minute, host: "a", status_class: "2xx", requests: 2, bytes: 15 },
			{ bucket: minute, host: "a", status_class: "5xx", requests: 1, bytes: 10 },
		],
	);
	assert.deepEqual(ips, []);
});

it("counts countries and ASNs per hour, IPs only when enabled", () => {
	const c = createCounter({});
	const geo = { country: "DE", asn: 3320, asnName: "Deutsche Telekom" };
	c.add(e("a", "1.1.1.1"), geo, { showIps: true });
	c.add(e("a", "1.1.1.1"), geo, { showIps: true });
	const hour = Math.floor(t / 3600000);
	const out = c.drain();
	assert.deepEqual(out.countries, [{ bucket: hour, host: "a", country: "DE", requests: 2 }]);
	assert.deepEqual(out.asns, [{ bucket: hour, host: "a", asn: 3320, asn_name: "Deutsche Telekom", requests: 2 }]);
	assert.deepEqual(out.ips, [{ bucket: hour, host: "a", ip: "1.1.1.1", requests: 2 }]);
});

it("caps distinct IPs per host and hour into an other bucket", () => {
	const c = createCounter({ maxPerKey: 3 });
	for (let i = 0; i < 5; i++) c.add(e("a", `10.0.0.${i}`), null, { showIps: true });
	const { ips } = c.drain();
	assert.equal(ips.length, 4);
	assert.equal(ips.find((r) => r.ip === "other").requests, 2);
});

it("caps distinct ASNs per host and hour into an other bucket", () => {
	const c = createCounter({ maxPerKey: 2 });
	for (let i = 1; i <= 4; i++)
		c.add(e("a", "1.1.1.1"), { country: "DE", asn: i, asnName: `N${i}` }, { showIps: false });
	const { asns } = c.drain();
	assert.equal(asns.length, 3);
	assert.deepEqual(
		asns.find((r) => r.asn === 0),
		{ bucket: Math.floor(t / 3600000), host: "a", asn: 0, asn_name: "Other", requests: 2 },
	);
});

it("uses -- when the country is missing", () => {
	const c = createCounter({});
	c.add(e("a", "1.1.1.1"), { asn: 1, asnName: "X" }, { showIps: false });
	assert.equal(c.drain().countries[0].country, "--");
});

it("drain empties the counter and reports skipped lines", () => {
	const c = createCounter({});
	c.skip();
	c.add(e("a", "1.1.1.1"), null, { showIps: false });
	assert.equal(c.drain().skipped, 1);
	const again = c.drain();
	assert.deepEqual([again.minutes.length, again.skipped], [0, 0]);
});
