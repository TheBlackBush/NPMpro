import { createIpRanges } from "../lib/ip-ranges.js";
import internalNginx from "./nginx.js";
import { runtimeExclusive } from "./runtime-queue.js";

// the network runtime settings apply renders ip_ranges.conf, starts and stops the Cloudflare refresh through it
const internalIpRanges = createIpRanges({
	nginx: { test: internalNginx.test, reload: internalNginx.reload },
	exclusive: runtimeExclusive,
});

export default internalIpRanges;
