import { RUNTIME_GROUPS } from "./runtime-rules.js";

// Rows with their own API and endpoints: the generic API must not change them
const DEDICATED_IDS = ["oidc", "monitoring", "geoip", "crowdsec", "landing_pages", "traffic-state", ...RUNTIME_GROUPS];
// Not listed or returned by the generic API: the reader position is internal, the runtime groups and crowdsec (sealed
// secrets) have their own GET
const HIDDEN_IDS = ["traffic-state", "crowdsec", "landing_pages", ...RUNTIME_GROUPS];

/**
 * @param   {string}  id
 * @returns {boolean} true when the generic /api/settings/:id route must refuse the id
 */
const isDedicatedSettingId = (id) => DEDICATED_IDS.includes(String(id).trim().toLowerCase());

export { DEDICATED_IDS, HIDDEN_IDS, isDedicatedSettingId };
