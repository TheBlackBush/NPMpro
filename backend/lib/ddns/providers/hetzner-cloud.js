import { bearer, collectZones, failAnswer, malformed } from "./zone-common.js";

export default {
	id: "hetzner-cloud",
	label: "Hetzner Cloud",
	credentialProvider: "hetzner-cloud",
	listZones: ({ fields, fetch }) =>
		collectZones({
			fetchPage: async (page) => {
				const secrets = [fields.dns_hetzner_cloud_api_token];
				const res = await fetch(`https://api.hetzner.cloud/v1/zones?page=${page}&per_page=50`, {
					headers: bearer(fields.dns_hetzner_cloud_api_token),
				});
				if (res.status !== 200) failAnswer(res, { hint: "Read access to the project's DNS zones", secrets });
				if (!Array.isArray(res.json?.zones)) throw malformed(res, secrets);
				return {
					names: res.json.zones.map((zone) => zone?.name),
					more: Boolean(res.json.meta?.pagination?.next_page),
				};
			},
		}),
};
