// Benchmark of the backend, outside the image. Runs the real backend with a fake nginx.
// Usage: cd backend && node ../.github/scripts/backend-bench.js [hosts=300] [rounds=5] [auditRows=200000] [trafficHosts=200]
// One JSON line per metric on stdout. Times are medians of the rounds, in milliseconds; counts are per round.
import { performance } from "node:perf_hooks";
import process from "node:process";
import { startApi } from "../../backend/test/support/api.js";

const hosts = Number(process.argv[2] ?? 300);
const rounds = Number(process.argv[3] ?? 5);
const auditRows = Number(process.argv[4] ?? 200000);
const trafficHosts = Number(process.argv[5] ?? 200);

const report = (name, value, extra = {}) =>
	process.stdout.write(`${JSON.stringify({ name, value: Math.round(value * 10) / 10, ...extra })}\n`);
const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const timed = async (run) => {
	const times = [];
	for (let round = 0; round < rounds; round++) {
		const start = performance.now();
		await run(round);
		times.push(performance.now() - start);
	}
	return median(times);
};
const ok = (answer) => {
	if (answer.status >= 300) throw new Error(`${answer.status}: ${answer.text}`);
	return answer.body;
};
const proxy = (name, extra = {}) => ({
	domain_names: Array.isArray(name) ? name : [name],
	forward_scheme: "http",
	forward_host: "10.0.0.1",
	forward_port: 80,
	...extra,
});

const api = await startApi();
// the first start ran inside startApi, over an empty database; its calls are in the log and its reloads in the counter
const firstStart = {
	tests: (await api.outside.calls()).filter((line) => line.startsWith("nginx -t")).length,
	reloads: api.outside.control.reloads,
};
try {
	const admin = await api.admin();
	const list = ok(
		await admin.post("/nginx/access-lists", {
			name: "bench",
			items: [{ username: "bob", password: "bobs-password-1" }],
			clients: [{ address: "10.1.0.0/16", directive: "allow" }],
		}),
	);
	const custom = { npmpro_access_list_type: "custom", npmpro_access_list_ids: [list.id] };
	for (let n = 0; n < hosts; n++) {
		ok(await admin.post("/nginx/proxy-hosts", proxy(`b${n}.example.com`, n < 50 ? custom : {})));
	}
	report("startup_first_nginx_tests", firstStart.tests, { hosts: 0 });
	report("startup_first_reloads", firstStart.reloads, { hosts: 0 });
	const nginxTests = async () => (await api.outside.calls()).filter((line) => line.startsWith("nginx -t")).length;

	const { loadEnabledHosts, regenerateAllHosts } = await import("../../backend/internal/regenerate.js");
	await api.outside.clearCalls();
	report("regenerate_ms", await timed(async () => regenerateAllHosts(await loadEnabledHosts())), { hosts });
	report("regenerate_nginx_tests", (await nginxTests()) / rounds, { hosts });

	await api.outside.clearCalls();
	const reloadsAccess = api.outside.control.reloads;
	report(
		"access_list_ms",
		await timed((round) => admin.put(`/nginx/access-lists/${list.id}`, { name: `bench ${round}` })),
		{ hosts: 50 },
	);
	report("access_list_nginx_tests", (await nginxTests()) / rounds, { hosts: 50 });
	report("access_list_reloads", (api.outside.control.reloads - reloadsAccess) / rounds, { hosts: 50 });

	let queries = 0;
	api.db.on("query", () => {
		queries += 1;
	});

	report("list_ms", await timed(() => admin.get("/nginx/proxy-hosts")), { hosts });
	queries = 0;
	ok(await admin.get("/nginx/proxy-hosts"));
	report("list_queries", queries, { hosts });

	// the real startup again over the populated database: a warm start (configs exist) and a full regeneration; the
	// regenerate_all start runs on unchanged config text, so applyAll skips the files it already wrote
	const { prepareApp } = await import("../../backend/startup.js");
	for (const mode of ["warm", "regenerate_all"]) {
		process.env.REGENERATE_ALL = mode === "regenerate_all" ? "true" : "false";
		process.env.ENV_SHA512SUM = "bench";
		await api.outside.clearCalls();
		const reloadsStart = api.outside.control.reloads;
		await prepareApp({ background: false });
		report(`startup_${mode}_nginx_tests`, await nginxTests(), { hosts });
		report(`startup_${mode}_reloads`, api.outside.control.reloads - reloadsStart, { hosts });
	}
	delete process.env.REGENERATE_ALL;
	for (const domains of [1, 5, 100]) {
		queries = 0;
		// a median of several creates: one call can take a WAL auto-checkpoint (every 1000 pages, two fsyncs)
		const names = (round) => Array.from({ length: domains }, (_, n) => `q${domains}-${round}-${n}.example.com`);
		report(
			"create_ms",
			await timed(async (round) => ok(await admin.post("/nginx/proxy-hosts", proxy(names(round))))),
			{
				domains,
			},
		);
		queries = 0;
		ok(await admin.post("/nginx/proxy-hosts", proxy(names(rounds))));
		report("create_queries", queries, { domains });
	}

	// the all-hosts traffic view (PERF-3 fix 1): 30 days of hour rows and one day of minute rows per host; the totals
	// migration, once it exists, writes the all-hosts rows from them
	const { createStore } = await import("../../backend/lib/traffic/store.js");
	const store = createStore(api.db);
	const now = Date.UTC(2026, 10, 10, 12, 0, 0);
	const hour = Math.floor(now / 3600000);
	const minute = Math.floor(now / 60000);
	for (let n = 0; n < trafficHosts; n++) {
		const host = `t${n}.example.com`;
		const hours = [];
		const countries = [];
		const asns = [];
		const ips = [];
		const minutes = [];
		for (let bucket = hour - 30 * 24; bucket < hour - 24; bucket++) {
			for (const status_class of ["2xx", "3xx", "4xx", "5xx"]) {
				hours.push({ bucket, host, status_class, requests: 10, bytes: 1000 });
			}
			for (const country of ["DE", "US"]) countries.push({ bucket, host, country, requests: 5 });
			for (const asn of [64500, 64501]) asns.push({ bucket, host, asn, asn_name: `AS${asn}`, requests: 5 });
			for (const ip of ["10.0.0.1", "10.0.0.2", "10.0.0.3"]) ips.push({ bucket, host, ip, requests: 3 });
		}
		for (let bucket = minute - 24 * 60; bucket <= minute; bucket++) {
			for (const status_class of ["2xx", "4xx"]) minutes.push({ bucket, host, status_class, requests: 1, bytes: 100 });
		}
		await api.db.batchInsert("traffic_hour", hours, 500);
		await api.db.batchInsert("traffic_country_hour", countries, 500);
		await api.db.batchInsert("traffic_asn_hour", asns, 500);
		await api.db.batchInsert("traffic_ip_hour", ips, 500);
		await api.db.batchInsert("traffic_minute", minutes, 500);
	}
	const totals = await import("../../backend/migrations/20261110120000_traffic_totals.js").catch(() => null);
	if (totals) {
		const start = performance.now();
		await totals.up(api.db);
		report("traffic_backfill_ms", performance.now() - start, { hosts: trafficHosts });
	}
	for (const range of ["24h", "30d"]) {
		report(
			`traffic_${range}_all_ms`,
			await timed(() => store.queryTraffic({ range, host: "", showIps: true, now })),
			{ hosts: trafficHosts },
		);
	}
	report(
		"traffic_30d_host_ms",
		await timed(() => store.queryTraffic({ range: "30d", host: "t7.example.com", showIps: true, now })),
		{ hosts: trafficHosts },
	);

	const rows = Array.from({ length: auditRows }, (_, n) => ({
		created_on: "2026-11-07 10:00:00",
		modified_on: "2026-11-07 10:00:00",
		user_id: 1,
		object_type: "proxy-host",
		object_id: n,
		action: "updated",
		meta: "{}",
	}));
	await api.db.batchInsert("audit_log", rows, 500);
	report("audit_list_ms", await timed(() => admin.get("/audit-log?limit=50&offset=1000")), { rows: auditRows });
	queries = 0;
	ok(await admin.get("/audit-log?limit=50&offset=1000"));
	report("audit_list_queries", queries, { rows: auditRows });
} finally {
	await api.stop();
}
