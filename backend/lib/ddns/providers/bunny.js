import { collectZones, failAnswer, malformed, statusRefusal } from "./zone-common.js";

const PER_PAGE = 500;
const HINT = "The account API key of bunny.net (dash.bunny.net, Account settings)";

/** Zone listing only: bunny.net has no DDNS updater here. HasMoreItems says whether a next page exists */
export default {
	id: "bunny",
	label: "bunny.net",
	credentialProvider: "bunny",
	testRefusal: statusRefusal({ 401: "wrong-key" }),
	listZones: ({ fields, fetch, maxPages }) =>
		collectZones({
			maxPages,
			fetchPage: async (page) => {
				const secrets = [fields.dns_bunny_api_key];
				const res = await fetch(`https://api.bunny.net/dnszone?page=${page}&perPage=${PER_PAGE}`, {
					headers: { AccessKey: fields.dns_bunny_api_key ?? "", Accept: "application/json" },
				});
				if (res.status !== 200) failAnswer(res, { hint: HINT, secrets });
				if (!Array.isArray(res.json?.Items)) throw malformed(res, secrets);
				return { names: res.json.Items.map((zone) => zone?.Domain), more: res.json.HasMoreItems === true };
			},
		}),
};
