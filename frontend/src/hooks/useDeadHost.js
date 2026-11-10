import { createDeadHost, getDeadHost, getDeadHosts, updateDeadHost } from "src/api/backend";
import { createHostHooks } from "./hostHooks";

const {
	useOne: useDeadHost,
	useList: useDeadHosts,
	useSave: useSetDeadHost,
} = createHostHooks("dead", {
	get: getDeadHost,
	getAll: getDeadHosts,
	create: createDeadHost,
	update: updateDeadHost,
	empty: () => ({
		id: 0,
		createdOn: "",
		modifiedOn: "",
		ownerUserId: 0,
		domainNames: [],
		certificateId: 0,
		sslForced: false,
		advancedConfig: "",
		npmproDirectory: "",
		npmproMtlsCertificateId: 0,
		npmproMtlsVerifyClientOptional: false,
		npmproHttp3Support: false,
		enabled: true,
		hstsEnabled: false,
		hstsSubdomains: false,
	}),
});

export { useDeadHost, useDeadHosts, useSetDeadHost };
