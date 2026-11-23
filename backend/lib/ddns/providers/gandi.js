import { bearer, collectZones, failAnswer, malformed } from "./zone-common.js";

const PER_PAGE = 100;

export default {
	id: "gandi",
	label: "Gandi",
	credentialProvider: "gandi",
	listZones: ({ fields, fetch }) =>
		collectZones({
			fetchPage: async (page) => {
				const secrets = [fields.dns_gandi_token];
				const res = await fetch(`https://api.gandi.net/v5/livedns/domains?page=${page}&per_page=${PER_PAGE}`, {
					headers: bearer(fields.dns_gandi_token),
				});
				if (res.status !== 200) failAnswer(res, { hint: "Manage domain technical configurations", secrets });
				if (!Array.isArray(res.json)) throw malformed(res, secrets);
				return { names: res.json.map((domain) => domain?.fqdn), more: res.json.length >= PER_PAGE };
			},
		}),
};
