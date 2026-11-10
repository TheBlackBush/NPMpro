import { createStream, getStream, getStreams, updateStream } from "src/api/backend";
import { createHostHooks } from "./hostHooks";

const {
	useOne: useStream,
	useList: useStreams,
	useSave: useSetStream,
} = createHostHooks("stream", {
	get: getStream,
	getAll: getStreams,
	create: createStream,
	update: updateStream,
	empty: () => ({
		id: 0,
		createdOn: "",
		modifiedOn: "",
		ownerUserId: 0,
		incomingPort: "",
		forwardingHost: "",
		forwardingPort: "",
		tcpForwarding: true,
		udpForwarding: false,
		npmproProxyProtocolForwarding: 0,
		npmproProxyTls: false,
		npmproAdvancedConfig: "",
		npmproDirectory: "",
		npmproMtlsCertificateId: 0,
		npmproMtlsVerifyClientOptional: false,
		enabled: true,
		certificateId: 0,
		npmproDescription: "",
	}),
});

export { useSetStream, useStream, useStreams };
