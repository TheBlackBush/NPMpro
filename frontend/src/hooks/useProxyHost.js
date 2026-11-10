import { createProxyHost, getProxyHost, getProxyHosts, updateProxyHost } from "src/api/backend";
import { createHostHooks } from "./hostHooks";

const {
	useOne: useProxyHost,
	useList: useProxyHosts,
	useSave: useSetProxyHost,
} = createHostHooks("proxy", {
	get: getProxyHost,
	getAll: getProxyHosts,
	create: createProxyHost,
	update: updateProxyHost,
	empty: () => ({
		id: 0,
		createdOn: "",
		modifiedOn: "",
		ownerUserId: 0,
		domainNames: [],
		forwardHost: "",
		forwardPort: 0,
		accessLists: [],
		locations: [],
		certificateId: 0,
		sslForced: false,
		advancedConfig: "",
		npmproLocationConfig: "",
		npmproDirectory: "",
		npmproMtlsCertificateId: 0,
		npmproMtlsVerifyClientOptional: false,
		npmproMtlsBypassAuthRequest: false,
		npmproHttp3Support: false,
		forwardScheme: "http",
		enabled: true,
		hstsEnabled: false,
		hstsSubdomains: false,
		npmproNoindex: false,
		npmproCrowdsecAppsec: false,
		npmproProxyResponseBuffering: false,
		npmproProxyRequestBuffering: false,
		npmproUpstreamCompression: false,
		npmproFancyindex: false,
		npmproXFrameOptions: "SAMEORIGIN",
		npmproAuthRequest: "none",
		npmproAuthRequestUpstream: "",
		npmproAccessListType: "public",
	}),
});

export { useProxyHost, useProxyHosts, useSetProxyHost };
