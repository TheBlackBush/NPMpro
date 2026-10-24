import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { createStore } from "../lib/traffic/store.js";
import { up } from "../migrations/20261024120000_monitoring.js";

const NOW = Date.UTC(2026, 9, 24, 12, 30, 0);
const MIN = Math.floor(NOW / 60000);

const setup = async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	await up(knex);
	return { knex, store: createStore(knex) };
};

const m = (bucket, status_class, requests, bytes = 10, host = "a") => ({ bucket, host, status_class, requests, bytes });

it("flush adds to existing rows and queries fill the series", async () => {
	const { knex, store } = await setup();
	await store.flush({ minutes: [m(MIN, "2xx", 2), m(MIN, "5xx", 1)] });
	await store.flush({
		minutes: [m(MIN, "2xx", 3)],
		countries: [{ bucket: Math.floor(NOW / 3600000), host: "a", country: "DE", requests: 4 }],
		asns: [{ bucket: Math.floor(NOW / 3600000), host: "a", asn: 64500, asn_name: "Net", requests: 4 }],
		ips: [{ bucket: Math.floor(NOW / 3600000), host: "a", ip: "1.2.3.4", requests: 4 }],
	});
	const r = await store.queryTraffic({ range: "1h", host: "", showIps: true, now: NOW });
	assert.deepEqual(r.totals, { requests: 6, bytes: 30, error_rate: 1 / 6 });
	assert.equal(r.series.length, 60);
	assert.equal(r.series.at(-1).by_class["2xx"], 5);
	assert.deepEqual(r.top_countries, [{ country: "DE", requests: 4 }]);
	assert.deepEqual(r.top_asns, [{ asn: 64500, asn_name: "Net", requests: 4 }]);
	assert.deepEqual(r.top_ips, [{ ip: "1.2.3.4", requests: 4 }]);
	assert.deepEqual(r.countries, { DE: 4 });
	const none = await store.queryTraffic({ range: "7d", host: "b", now: NOW });
	assert.equal(none.totals.requests, 0);
	assert.deepEqual(none.top_ips, []);
	await knex.destroy();
});

it("rolls old minutes into hours, keeps totals and prunes by retention", async () => {
	const { knex, store } = await setup();
	const old = MIN - 25 * 60;
	await store.flush({ minutes: [m(old, "2xx", 2), m(MIN, "2xx", 1)] });
	await store.rollUpAndPrune({ now: NOW, retentionDays: 30 });
	assert.equal((await knex("traffic_minute")).length, 1);
	assert.equal(Number((await knex("traffic_hour"))[0].requests), 2);
	assert.equal((await store.queryTraffic({ range: "7d", now: NOW })).totals.requests, 3);
	await store.rollUpAndPrune({ now: NOW + 31 * 86400000, retentionDays: 30 });
	assert.equal((await knex("traffic_hour")).length, 0);
	await knex.destroy();
});

it("summary reports today and deleteIps clears the ip table", async () => {
	const { knex, store } = await setup();
	const hour = Math.floor(NOW / 3600000);
	await store.flush({
		minutes: [m(MIN, "2xx", 3), m(MIN, "4xx", 1)],
		countries: [{ bucket: hour, host: "a", country: "FR", requests: 3 }],
		ips: [{ bucket: hour, host: "a", ip: "1.1.1.1", requests: 1 }],
	});
	const s = await store.summary({ now: NOW });
	assert.equal(s.requests_today, 4);
	assert.equal(s.error_rate_today, 0.25);
	assert.equal(s.top_country_today, "FR");
	assert.equal(s.series_24h.length, 24);
	await store.deleteIps();
	assert.equal((await knex("traffic_ip_hour")).length, 0);
	await knex.destroy();
});
