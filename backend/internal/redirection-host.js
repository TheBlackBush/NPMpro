import redirectionHostModel from "../models/redirection_host.js";
import createHostService from "./host-service.js";

const internalRedirectionHost = createHostService({
	type: {
		hostType: "redirection_host",
		auditType: "redirection-host",
		permission: "redirection_hosts",
		takenType: "redirection",
		label: "Host",
	},
	model: redirectionHostModel,
	expand: ["certificate"],
});

export default internalRedirectionHost;
