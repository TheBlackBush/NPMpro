import cloudflare from "./cloudflare.js";
import digitalocean from "./digitalocean.js";
import gandi from "./gandi.js";
import hetznerCloud from "./hetzner-cloud.js";
import ovh from "./ovh.js";

/** The providers with an API, in the order the UI shows them */
const PROVIDERS = Object.freeze([cloudflare, digitalocean, hetznerCloud, gandi, ovh]);

const providerById = (id) => PROVIDERS.find((provider) => provider.id === id) ?? null;

const providerForCredential = (credentialProvider) =>
	PROVIDERS.find((provider) => provider.credentialProvider === credentialProvider) ?? null;

const listsDomains = (credentialProvider) => providerForCredential(credentialProvider) !== null;

export { listsDomains, PROVIDERS, providerById, providerForCredential };
