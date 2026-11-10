import { createRedirectionHost, getRedirectionHost, getRedirectionHosts, updateRedirectionHost } from "src/api/backend";
import { createHostHooks } from "./hostHooks";

const {
	useOne: useRedirectionHost,
	useList: useRedirectionHosts,
	useSave: useSetRedirectionHost,
} = createHostHooks("redirection", {
	get: getRedirectionHost,
	getAll: getRedirectionHosts,
	create: createRedirectionHost,
	update: updateRedirectionHost,
	empty: () => ({
		id: 0,
		createdOn: "",
		modifiedOn: "",
		ownerUserId: 0,
		domainNames: [],
		forwardDomainName: "",
		preservePath: false,
		certificateId: 0,
		sslForced: false,
		advancedConfig: "",
		npmproDirectory: "",
		npmproMtlsCertificateId: 0,
		npmproMtlsVerifyClientOptional: false,
		npmproHttp3Support: false,
		forwardScheme: "$scheme",
		forwardHttpCode: 301,
		enabled: true,
		hstsEnabled: false,
		hstsSubdomains: false,
	}),
});

export { useRedirectionHost, useRedirectionHosts, useSetRedirectionHost };
