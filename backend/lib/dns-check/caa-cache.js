import { createHostCache } from "./host-cache.js";

// The cache of the CAA results of the ACME certificates (internal/certificate-caa.js): in memory, 6 hours, 2000
// entries at most. It is its own module so the places that invalidate it (a restore, a change of the CA list) need
// not import the service.

const caaCache = createHostCache();

export { caaCache };
