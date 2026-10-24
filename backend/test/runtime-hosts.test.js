import assert from "node:assert/strict";
import { it } from "node:test";
import { createHostRenderer } from "../lib/runtime-hosts.js";

const modelOf = (rows) => {
	const queries = [];
	return {
		queries,
		query: () => ({
			where: (column, value) => ({
				withGraphFetched: (graph) => {
					queries.push({ column, value, graph });
					return Promise.resolve(rows.filter((row) => row[column] === value));
				},
			}),
		}),
	};
};

const le = (id, enabled = 1) => ({ id, enabled, certificate_id: id, certificate: { provider: "letsencrypt" } });
const custom = (id) => ({ id, enabled: 1, certificate_id: id, certificate: { provider: "other" } });

const renderer = (files) => {
	const proxy = modelOf([le(1), le(2, 0), custom(3), { id: 4, enabled: 1, certificate_id: 0, certificate: null }]);
	const stream = modelOf([le(5), le(6)]);
	const renders = [];
	const instance = createHostRenderer({
		hostTypes: [
			[proxy, "proxy_host", "certificate"],
			[stream, "stream", "certificate"],
		],
		getConfigName: (type, id) => `/data/nginx/${type}/${id}.conf`,
		renderConfig: (type, host, options) => {
			renders.push({ type, id: host.id, options });
			return Promise.resolve(`${type} ${host.id}\n`);
		},
		exists: (file) => files.includes(file),
	});
	return { ...instance, renders, proxy };
};

it("re-renders the enabled hosts with a config file whose certificate follows the changed stapling key", async () => {
	const files = ["/data/nginx/proxy_host/1.conf", "/data/nginx/proxy_host/3.conf", "/data/nginx/stream/5.conf"];
	const r = renderer(files);
	const env = { ACME_OCSP_STAPLING: "true" };
	const out = await r.renderRuntimeHosts("certificates", { changed: ["ocsp_stapling"], startup: false, env });
	// 2 is disabled (the query), 6 has no config file (.err or not generated), 3 and 4 do not follow ocsp_stapling
	assert.deepEqual(out, [
		{ path: "/data/nginx/proxy_host/1.conf", content: "proxy_host 1\n", nginx: true },
		{ path: "/data/nginx/stream/5.conf", content: "stream 5\n", nginx: true },
	]);
	assert.deepEqual(r.proxy.queries, [{ column: "enabled", value: 1, graph: "certificate" }]);
	assert.deepEqual(
		r.renders.map(({ options }) => options),
		[
			{ env, fetchMissingOcsp: false },
			{ env, fetchMissingOcsp: false },
		],
	);

	const customOut = await r.renderRuntimeHosts("certificates", { changed: ["custom_ocsp_stapling"], env });
	assert.deepEqual(
		customOut.map((file) => file.path),
		["/data/nginx/proxy_host/3.conf"],
	);
});

it("renders nothing at startup, for other keys or other groups", async () => {
	const r = renderer(["/data/nginx/proxy_host/1.conf"]);
	assert.deepEqual(await r.renderRuntimeHosts("certificates", { changed: ["ocsp_stapling"], startup: true }), []);
	assert.deepEqual(await r.renderRuntimeHosts("certificates", { changed: ["default_certificate_id"] }), []);
	assert.deepEqual(await r.renderRuntimeHosts("network", { changed: ["trusted_ips"] }), []);
	assert.deepEqual(r.renders, []);
});
