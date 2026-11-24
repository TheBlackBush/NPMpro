import { bearer, collectZones, failAnswer, malformed } from "./zone-common.js";

const PER_PAGE = 100;
const HINT = "A token with the domains read-only scope";

/** Zone listing only: Linode has no DDNS updater here */
export default {
	id: "linode",
	label: "Linode",
	credentialProvider: "linode",
	listZones: ({ fields, fetch }) =>
		collectZones({
			fetchPage: async (page) => {
				const secrets = [fields.dns_linode_key];
				const res = await fetch(`https://api.linode.com/v4/domains?page=${page}&page_size=${PER_PAGE}`, {
					headers: bearer(fields.dns_linode_key),
				});
				if (res.status !== 200) failAnswer(res, { hint: HINT, secrets });
				if (!Array.isArray(res.json?.data)) throw malformed(res, secrets);
				const pages = Number(res.json.pages);
				return {
					// a secondary zone takes no record through this token
					names: res.json.data.map((zone) => (zone?.type === "slave" ? "" : zone?.domain)),
					more: Number.isFinite(pages) && page < pages,
				};
			},
		}),
};
