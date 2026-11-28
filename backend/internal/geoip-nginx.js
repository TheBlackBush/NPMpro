import { GEOIP_DIR } from "../lib/geoip/instance.js";
import { countryDatabase, hasCustomDirective } from "../lib/geoip/usable.js";
import { getGeoipConfig } from "../lib/monitoring-config.js";
import { rooted } from "../lib/paths.js";

const GEOIP_CONF = rooted("/data/npmpro/nginx/geoip.conf");
const GEOIP_LISTS_CONF = rooted("/data/npmpro/nginx/geoip-lists.conf");

/**
 * Whether country rules can work (rule 12): a custom geoip_country directive wins, else the Country file of the active
 * provider must be usable
 *
 * @returns {Promise<{available: boolean, provider: string, custom_directive: boolean, file: string, variant: string}>}
 */
const geoipStatus = async () => {
	const { provider } = (await getGeoipConfig()).values;
	const customDirective = await hasCustomDirective();
	const { usable, file } = await countryDatabase({ dir: GEOIP_DIR, provider });
	let variant = "off";
	if (customDirective) variant = "custom";
	else if (usable) variant = "database";
	return { available: variant !== "off", provider, custom_directive: customDirective, file, variant };
};

export { GEOIP_CONF, GEOIP_LISTS_CONF, geoipStatus };
