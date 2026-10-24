import { createGeoip } from "./lookup.js";

const GEOIP_DIR = "/data/goaccess/geoip";

/** Shared GeoIP lookup instance for the whole backend */
const geoip = createGeoip({ dir: GEOIP_DIR });

export { GEOIP_DIR, geoip };
