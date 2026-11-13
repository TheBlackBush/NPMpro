import { assertPageFields, keepSavedPages } from "../lib/landing-pages/html.js";
import deadHostModel from "../models/dead_host.js";
import internalHost from "./host.js";
import createHostService from "./host-service.js";

const internalDeadHost = createHostService({
	type: { hostType: "dead_host", auditType: "dead-host", permission: "dead_hosts", takenType: "dead", label: "Host" },
	model: deadHostModel,
	expand: ["certificate"],
	hooks: {
		cleanData: (_access, createCertificate, data, existingRow) => {
			assertPageFields("dead_host", data, existingRow ?? {});
			keepSavedPages("dead_host", data, existingRow);
			return internalHost.cleanSslHstsData(createCertificate, data, existingRow);
		},
	},
});

export default internalDeadHost;
