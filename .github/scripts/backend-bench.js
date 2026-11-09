// Benchmark of the backend refactor (roadmap 11 part 3), outside the image. Runs the real backend with a fake nginx.
// Usage: cd backend && node ../.github/scripts/backend-bench.js [hosts=300] [rounds=5] [auditRows=200000]
// One JSON line per metric on stdout. Times are medians of the rounds, in milliseconds; counts are per round.
import { performance } from "node:perf_hooks";
import process from "node:process";
import { startApi } from "../../backend/test/support/api.js";

const hosts = Number(process.argv[2] ?? 300);
const rounds = Number(process.argv[3] ?? 5);
const auditRows = Number(process.argv[4] ?? 200000);

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
