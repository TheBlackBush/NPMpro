import errs from "../lib/error.js";
import { castJsonIfNeed } from "../lib/helpers.js";
import { assertHostConfig } from "../lib/host-config-guard.js";
import internalAuditLog from "./audit-log.js";
import internalCertificate from "./certificate.js";
import internalHost from "./host.js";
import internalNginx from "./nginx.js";

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
			this.where(castJsonIfNeed("domain_names"), "like", `%${searchQuery}%`);
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
	const flow = { ...domainHooks(model, takenType), ...hooks };

	const audit = (access, action, id, meta) =>
		internalAuditLog.add(access, { action, object_type: auditType, object_id: id, meta });

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
		create: async (access, data) => {
			let thisData = flow.prepareCreate(data);
			const createCertificate = await internalHost.checkCertificates(access, thisData);

			access.can(`${permission}:manage`);
			assertHostConfig(access, hostType, data);
			await flow.assertFreeOnCreate(thisData);

			thisData.owner_user_id = access.token.getUserId(1);
			thisData = await flow.cleanData(access, createCertificate, thisData);

			if (createCertificate) {
				thisData.certificate_id = (await internalCertificate.createQuickCertificate(access, thisData)).id;
			}

			const createdRow = await flow.insertRow(thisData);

			return auditAfter(access, "created", createdRow.id, async () => {
				const row = await service.get(access, { id: createdRow.id, expand });
				await internalNginx.configure(model, hostType, row);
			});
		},

		update: async (access, data) => {
			let existingRow = flow.loadExistingFirst ? await service.get(access, { id: data.id }) : undefined;
			let thisData = flow.prepareUpdate(data, existingRow);
			const createCertificate = await internalHost.checkCertificates(access, thisData);

			access.can(`${permission}:manage`);

			existingRow ??= await service.get(access, { id: thisData.id });
			assertHostConfig(access, hostType, data, existingRow);
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

			return auditAfter(access, "updated", thisData.id, async () => {
				const row = await service.get(access, { id: thisData.id, expand });
				await internalNginx.configure(model, hostType, row);
			});
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

			try {
				await internalNginx.removeConfig(hostType, row, flow.removeOptions(row));
			} finally {
				await audit(access, "deleted", row.id, row);
			}

			return row;
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

			return auditAfter(access, "enabled", row.id, () => internalNginx.configure(model, hostType, row));
		},

		disable: async (access, data) => {
			access.can(`${permission}:manage`);

			const row = await service.get(access, { id: data.id });
			if (!row.enabled) {
				throw new errs.ValidationError(`${label} is already disabled`);
			}

			await model.query().where("id", row.id).patch({ enabled: 0 });

			return auditAfter(access, "disabled", row.id, () => internalNginx.removeConfig(hostType, row));
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

			if (expandList) query.withGraphFetched(`[${expandList.join(", ")}]`);

			return query;
		},

		getCount: (...args) => internalHost.hostCounts(model).getCount(...args),
		getErrorCount: (...args) => internalHost.hostCounts(model).getErrorCount(...args),
	};

	return service;
};

export default createHostService;
