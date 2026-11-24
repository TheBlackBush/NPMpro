import { bearer, collectZones, failAnswer, malformed } from "./zone-common.js";

const PER_PAGE = 500;
const HINT = "The IP access control list of the API key";

/** Zone listing only: Vultr pages by cursor (meta.links.next), an empty next ends the list */
export default {
	id: "vultr",
	label: "Vultr",
	credentialProvider: "vultr",
	listZones: ({ fields, fetch }) => {
		let cursor = "";
		return collectZones({
			fetchPage: async () => {
				const secrets = [fields.dns_vultr_key];
				const query = `per_page=${PER_PAGE}${cursor === "" ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
				const res = await fetch(`https://api.vultr.com/v2/domains?${query}`, {
					headers: bearer(fields.dns_vultr_key),
				});
				if (res.status !== 200) failAnswer(res, { hint: HINT, secrets });
				if (!Array.isArray(res.json?.domains)) throw malformed(res, secrets);
				const next = res.json.meta?.links?.next;
				cursor = typeof next === "string" ? next : "";
				return { names: res.json.domains.map((zone) => zone?.domain), more: cursor !== "" };
			},
		});
	},
};
