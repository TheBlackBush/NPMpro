import { bearer, collectZones, failAnswer, malformed } from "./zone-common.js";

export default {
	id: "digitalocean",
	label: "DigitalOcean",
	credentialProvider: "digitalocean",
	listZones: ({ fields, fetch }) =>
		collectZones({
			fetchPage: async (page) => {
				const secrets = [fields.dns_digitalocean_token];
				const res = await fetch(`https://api.digitalocean.com/v2/domains?page=${page}&per_page=200`, {
					headers: bearer(fields.dns_digitalocean_token),
				});
				if (res.status !== 200) failAnswer(res, { hint: "domain:read", secrets });
				if (!Array.isArray(res.json?.domains)) throw malformed(res, secrets);
				return {
					names: res.json.domains.map((domain) => domain?.name),
					more: Boolean(res.json.links?.pages?.next),
				};
			},
		}),
};
