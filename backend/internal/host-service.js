import { hostCheckCache } from "../lib/dns-check/host-cache.js";
import errs from "../lib/error.js";
import { castJsonIfNeed } from "../lib/helpers.js";
import { assertHostConfig } from "../lib/host-config-guard.js";
import { uniqueTags } from "../lib/host-tags.js";
import { auditPageHtml, withoutPageHtml } from "../lib/landing-pages/types.js";
import { global as logger } from "../logger.js";
import internalAuditLog from "./audit-log.js";
import internalCertificate from "./certificate.js";
import internalHost from "./host.js";
import internalHostDnsRecord from "./host-dns-record.js";
import { clearHostConfig } from "./host-notify.js";
import internalNginx from "./nginx.js";

const DNS_RECORDS = "dns_records";
const DNS_HOST_TYPES = new Set(["proxy_host", "redirection_host", "dead_host"]);

// two tags that differ only in case are one tag
const withUniqueTags = (data) =>
	Array.isArray(data.npmpro_tags) ? { ...data, npmpro_tags: uniqueTags(data.npmpro_tags) } : data;

/**
 * The DNS work of a host's option (npmpro_dns_records) runs after the host's save, outside its transaction, and never
 * fails the request: an error is logged and the answer simply has no states.
 *
 * @returns {Promise<Object[]|null>}
 */
const dnsStates = async (label, work) => {
	try {
		return await work();
	} catch (error) {
		logger.warn(`Host DNS records: ${label} failed: ${error?.message}`);
		return null;
	}
};

/** A ticked name must be one of the host's names (checked before anything is saved) */
const assertTicksAreNames = (wanted, names) => {
	if (!Array.isArray(wanted)) return;
	const own = new Set((names ?? []).map((name) => String(name).trim().toLowerCase()));
	for (const entry of wanted) {
		if (
			!own.has(
				String(entry?.name ?? "")
					.trim()
					.toLowerCase(),
			)
		) {
			throw new errs.ValidationError(
				`The name ${entry?.name} is not one of the host's names`,
				"error.host-dns-name-not-host",
				{ values: { name: String(entry?.name ?? "") } },
			);
		}
	}
};

/** The answer carries the name states only when the host has the option (a host without it is answered as before) */
const withDnsStates = (row, states) => {
	if (Array.isArray(states) && states.length > 0) row.npmpro_dns_records = states;
	return row;
};

/** The hooks of a host with domain names; a type replaces what differs */
const domainHooks = (model, takenType) => ({
	loadExistingFirst: false,
	prepareCreate: (data) => data,
	prepareUpdate: (data) => data,
	assertFreeOnCreate: (data) => internalHost.assertHostnamesFree(data.domain_names),
	assertFreeOnUpdate: async (data) => {
		if (data.domain_names !== undefined) {
			await internalHost.assertHostnamesFree(data.domain_names, { ignoreType: takenType, ignoreId: data.id });
		}
	},
	assertFreeOnEnable: (row) => internalHost.assertHostnamesFree(row.domain_names, { suffix: " by an active host" }),
	cleanData: (_access, createCertificate, data, existingRow) =>
		internalHost.cleanSslHstsData(createCertificate, data, existingRow),
	insertRow: (data) => model.query().insertAndFetch(data),
	patchRow: (data) => model.query().where({ id: data.id }).patch(data),
	deleteRow: (row) => model.query().deleteById(row.id),
	removeOptions: () => undefined,
	allowGraph: "[certificate]",
	baseGraph: null,
	listGraph: "[owner,certificate]",
	applyListOrder: (query) => query.orderBy(castJsonIfNeed("domain_names"), "ASC"),
	applySearch: (query, searchQuery) =>
		query.where(function () {
			this.where(castJsonIfNeed("domain_names"), "like", `%${searchQuery}%`)
				.orWhere("npmpro_description", "like", `%${searchQuery}%`)
				.orWhere(castJsonIfNeed("npmpro_tags"), "like", `%${searchQuery}%`);
		}),
});

/**
 * The service of a host type. The order of the steps is behaviour: certificates are looked up before access.can, every
 * check runs before a new certificate is requested, and the audit row is written in finally.
 *
 * @param   {Object}    options
 * @param   {Object}    options.type    { hostType, auditType, permission, takenType, label }
 * @param   {Object}    options.model
 * @param   {String[]}  options.expand  the relations a config is rendered from
 * @param   {Object}    [options.hooks]
 * @returns {Object}
 */
const createHostService = ({ type, model, expand, hooks = {} }) => {
	const { hostType, auditType, permission, takenType, label } = type;
	// streams have no names and no host record option
	const hasDns = DNS_HOST_TYPES.has(hostType);
	const dns = (what, work) => (hasDns ? dnsStates(what, work) : Promise.resolve(null));
	const flow = { ...domainHooks(model, takenType), ...hooks };

	const audit = (access, action, id, meta) =>
		internalAuditLog.add(access, { action, object_type: auditType, object_id: id, meta: auditPageHtml(meta) });

	const auditAfter = async (access, action, id, step) => {
		let savedRow;
		try {
			await step();
		} finally {
			savedRow = await service.get(access, { id });
			await audit(access, action, savedRow.id, savedRow);
		}
		return savedRow;
	};

	const service = {
		create: async (access, input) => {
			const { npmpro_dns_records: wanted, ...data } = input;
			let thisData = flow.prepareCreate(withUniqueTags(data));
			const createCertificate = await internalHost.checkCertificates(access, thisData);

			access.can(`${permission}:manage`);
			assertHostConfig(access, hostType, data);
			if (hasDns) assertTicksAreNames(wanted, data.domain_names);
			await flow.assertFreeOnCreate(thisData);

			thisData.owner_user_id = access.token.getUserId(1);
			thisData = await flow.cleanData(access, createCertificate, thisData);

			if (createCertificate) {
				thisData.certificate_id = (await internalCertificate.createQuickCertificate(access, thisData)).id;
			}

			const createdRow = await flow.insertRow(thisData);

			const savedRow = await auditAfter(access, "created", createdRow.id, async () => {
				const row = await service.get(access, { id: createdRow.id, expand });
				await internalNginx.configure(model, hostType, row);
			});
			return withDnsStates(
				savedRow,
				await dns("the create", () =>
					internalHostDnsRecord.applyHost(access, {
						hostType,
						hostBefore: null,
						hostAfter: savedRow,
						wanted,
					}),
				),
			);
		},

		update: async (access, input) => {
			const { npmpro_dns_records: wanted, ...data } = input;
			let existingRow = flow.loadExistingFirst ? await service.get(access, { id: data.id }) : undefined;
			let thisData = flow.prepareUpdate(withUniqueTags(data), existingRow);
			const createCertificate = await internalHost.checkCertificates(access, thisData);

			access.can(`${permission}:manage`);

			existingRow ??= await service.get(access, { id: thisData.id });
			// the raw payload, not thisData: thisData already holds the stored values of the fields the payload omits
			assertHostConfig(access, hostType, data, existingRow);
			if (hasDns) assertTicksAreNames(wanted, data.domain_names ?? existingRow.domain_names);
			await flow.assertFreeOnUpdate(thisData, existingRow);

			thisData = await flow.cleanData(access, createCertificate, thisData, existingRow);

			if (createCertificate) {
				const cert = await internalCertificate.createQuickCertificate(access, {
					...thisData,
					domain_names: thisData.domain_names || existingRow.domain_names,
				});
				thisData.certificate_id = cert.id;
			}

			await flow.patchRow(thisData);
			hostCheckCache.clearHost(hostType, thisData.id);

			const savedRow = await auditAfter(access, "updated", thisData.id, async () => {
				const row = await service.get(access, { id: thisData.id, expand });
				await internalNginx.configure(model, hostType, row);
			});
			return withDnsStates(
				savedRow,
				await dns("the update", () =>
					internalHostDnsRecord.applyHost(access, {
						hostType,
						hostBefore: existingRow,
						hostAfter: savedRow,
						wanted,
					}),
				),
			);
		},

		get: async (access, data) => {
			access.can(`${permission}:view`);

			const query = model.query().where("id", data.id).allowGraph(flow.allowGraph).first();
			if (flow.baseGraph) query.withGraphFetched(flow.baseGraph);

			if (access.visibility !== "all") {
				query.andWhere("owner_user_id", access.token.getUserId(1));
			}

			if (data.expand) query.withGraphFetched(`[${data.expand.join(", ")}]`);

			const row = await query;
			if (!row?.id) {
				throw new errs.ItemNotFoundError(data.id);
			}

			return row;
		},

		delete: async (access, data) => {
			access.can(`${permission}:manage`);

			const row = await service.get(access, { id: data.id });

			await flow.deleteRow(row);
			hostCheckCache.clearHost(hostType, row.id);
			clearHostConfig(hostType, row.id);

			let states = null;
			try {
				await internalNginx.removeConfig(hostType, row, flow.removeOptions(row));
			} finally {
				states = await dns("the delete", () => internalHostDnsRecord.onDelete(access, { hostType, host: row }));
				await audit(access, "deleted", row.id, row);
			}

			return withDnsStates(row, states);
		},

		enable: async (access, data) => {
			access.can(`${permission}:manage`);

			const row = await service.get(access, { id: data.id, expand });
			if (row.enabled) {
				throw new errs.ValidationError(`${label} is already enabled`);
			}

			await flow.assertFreeOnEnable(row);

			row.enabled = 1;

			await model.query().where("id", row.id).patch({ enabled: 1 });
			hostCheckCache.clearHost(hostType, row.id);

			const savedRow = await auditAfter(access, "enabled", row.id, () =>
				internalNginx.configure(model, hostType, row, { change: true }),
			);
			return withDnsStates(
				savedRow,
				await dns("the enable", () => internalHostDnsRecord.onEnable(access, { hostType, host: savedRow })),
			);
		},

		disable: async (access, data) => {
			access.can(`${permission}:manage`);

			const row = await service.get(access, { id: data.id });
			if (!row.enabled) {
				throw new errs.ValidationError(`${label} is already disabled`);
			}

			await model.query().where("id", row.id).patch({ enabled: 0 });
			hostCheckCache.clearHost(hostType, row.id);
			// a disabled host is no problem any more: its config state goes without an event, enabling records it again
			clearHostConfig(hostType, row.id);

			const savedRow = await auditAfter(access, "disabled", row.id, () =>
				internalNginx.removeConfig(hostType, row, { saved: row }),
			);
			return withDnsStates(
				savedRow,
				await dns("the disable", () => internalHostDnsRecord.onDisable(access, { hostType, host: savedRow })),
			);
		},

		getAll: (access, expandList, searchQuery) => {
			access.can(`${permission}:view`);

			const query = model.query().groupBy("id").allowGraph(flow.listGraph);
			if (flow.baseGraph) query.withGraphFetched(flow.baseGraph);
			flow.applyListOrder(query);

			if (access.visibility !== "all") {
				query.andWhere("owner_user_id", access.token.getUserId(1));
			}

			if (typeof searchQuery === "string" && searchQuery.length > 0) {
				flow.applySearch(query, searchQuery);
			}

			// dns_records is not a relation: the name states of each host that has the option
			const relations = (expandList ?? []).filter((name) => name !== DNS_RECORDS);
			if (relations.length > 0) query.withGraphFetched(`[${relations.join(", ")}]`);

			// the list has no page HTML, neither its own nor that of the access lists it expands
			query.runAfter((rows) => (Array.isArray(rows) ? rows.map(withoutPageHtml) : rows));
			if (hasDns && expandList?.includes(DNS_RECORDS)) {
				query.runAfter(async (rows) => {
					if (!Array.isArray(rows)) return rows;
					// one query for the rows of every listed host
					const all = await dns("the list", () =>
						internalHostDnsRecord.statesOfMany(access, { hostType, hosts: rows }),
					);
					for (const row of rows) withDnsStates(row, all?.get(row.id));
					return rows;
				});
			}

			return query;
		},

		/** Adds the name states of the host's DNS option to a row the user may view (none for a host without it) */
		addDnsRecords: async (access, row) => {
			if (!hasDns) return row;
			const states = await dns("the read", () => internalHostDnsRecord.statesOf(access, { hostType, host: row }));
			return withDnsStates(row, states);
		},

		getCount: (...args) => internalHost.hostCounts(model).getCount(...args),
		getErrorCount: (...args) => internalHost.hostCounts(model).getErrorCount(...args),
	};

	return service;
};

export default createHostService;
