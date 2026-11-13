import { PROXY_HOST_EXPAND, PROXY_HOST_GRAPH } from "../lib/host-expand.js";
import { assertPageFields, keepSavedPages } from "../lib/landing-pages/html.js";
import locationModel from "../models/location.js";
import proxyHostModel from "../models/proxy_host.js";
import internalHost from "./host.js";
import createHostService from "./host-service.js";
import internalProxyHostAccessList from "./proxy-host-access-list.js";

const replaceLocationsAndAccessLists = async (trx, proxyHostId, data) => {
	const insertAccessLists = async (locationId, accessListIds) => {
		if (accessListIds.length > 0) {
			await trx("npmpro_proxy_host_access_list").insert(
				accessListIds.map((access_list_id, position) => ({
					proxy_host_id: proxyHostId,
					location_id: locationId,
					access_list_id,
					position,
				})),
			);
		}
	};

	await trx("npmpro_proxy_host_access_list").where("proxy_host_id", proxyHostId).delete();
	await locationModel.query(trx).where("proxy_host_id", proxyHostId).delete();
	await insertAccessLists(0, data.npmpro_access_list_ids);
	for (const { id, npmpro_access_list_ids: accessListIds, ...location } of data.locations ?? []) {
		await insertAccessLists(
			(await locationModel.query(trx).insert({ ...location, proxy_host_id: proxyHostId })).id,
			accessListIds,
		);
	}
};

const cleanForwardOptions = (item) => {
	const scheme = item.forward_scheme ?? "http";
	if (scheme !== "empty") {
		if (!["http", "https"].includes(scheme)) {
			item.npmpro_proxy_request_buffering = false;
			item.npmpro_proxy_response_buffering = false;
		}
		if (scheme === "path") {
			item.npmpro_upstream_compression = false;
		} else {
			item.npmpro_fancyindex = false;
		}
	}
	if (!item.npmpro_crowdsec_appsec) item.npmpro_proxy_request_buffering = false;
	if ((item.npmpro_auth_request ?? "none") === "none") item.npmpro_auth_request_upstream = "";
};

const internalProxyHost = createHostService({
	type: {
		hostType: "proxy_host",
		auditType: "proxy-host",
		permission: "proxy_hosts",
		takenType: "proxy",
		label: "Host",
	},
	model: proxyHostModel,
	expand: PROXY_HOST_EXPAND,
	hooks: {
		// the access list check runs here, so it stays before the new certificate is requested
		cleanData: async (access, createCertificate, data, existingRow) => {
			assertPageFields("proxy_host", data, existingRow ?? {});
			keepSavedPages("proxy_host", data, existingRow);
			const cleaned = internalProxyHostAccessList.cleanAccessListTypes(
				internalHost.cleanSslHstsData(createCertificate, data, existingRow),
			);
			for (const item of [cleaned, ...(cleaned.locations ?? [])]) cleanForwardOptions(item);
			await internalProxyHostAccessList.validateAccessLists(access, cleaned);
			return cleaned;
		},
		insertRow: (data) =>
			proxyHostModel.transaction(async (trx) => {
				const insertedRow = await proxyHostModel.query(trx).insertAndFetch(data);
				await replaceLocationsAndAccessLists(trx, insertedRow.id, data);
				return insertedRow;
			}),
		patchRow: (data) =>
			proxyHostModel.transaction(async (trx) => {
				await proxyHostModel.query(trx).where({ id: data.id }).patch(data);
				await replaceLocationsAndAccessLists(trx, data.id, data);
			}),
		deleteRow: (row) =>
			proxyHostModel.transaction(async (trx) => {
				await trx("npmpro_proxy_host_access_list").where("proxy_host_id", row.id).delete();
				await locationModel.query(trx).where("proxy_host_id", row.id).delete();
				await proxyHostModel.query(trx).deleteById(row.id);
			}),
		removeOptions: (row) => ({ also: () => internalProxyHostAccessList.delete(row) }),
		allowGraph: PROXY_HOST_GRAPH,
		baseGraph: "[access_lists, locations.access_lists]",
		listGraph: "[owner,access_lists,certificate,locations.access_lists]",
	},
});

export default internalProxyHost;
