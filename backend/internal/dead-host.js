import deadHostModel from "../models/dead_host.js";
import createHostService from "./host-service.js";

const internalDeadHost = createHostService({
	type: { hostType: "dead_host", auditType: "dead-host", permission: "dead_hosts", takenType: "dead", label: "Host" },
	model: deadHostModel,
	expand: ["certificate"],
});

export default internalDeadHost;
