import { bearer, collectZones, failAnswer, malformed } from "./zone-common.js";

const HINT = "Zone Read";

const authHeaders = (fields) =>
	fields.dns_cloudflare_api_token
		? bearer(fields.dns_cloudflare_api_token)
		: {
				"X-Auth-Email": fields.dns_cloudflare_email ?? "",
				"X-Auth-Key": fields.dns_cloudflare_api_key ?? "",
				Accept: "application/json",
			};

// Cloudflare error codes that mean the credential is refused (authentication or permission)
const AUTH_CODES = new Set([9109, 10_000, 9103, 9106, 6003, 6111]);
const isAuthRefusal = (body) => body?.errors?.some?.((error) => AUTH_CODES.has(error?.code)) === true;

const secretsOf = (fields) =>
	[fields.dns_cloudflare_api_token, fields.dns_cloudflare_api_key].filter((value) => typeof value === "string");

export default {
	id: "cloudflare",
	label: "Cloudflare",
	credentialProvider: "cloudflare",
	listZones: ({ fields, fetch }) =>
		collectZones({
			fetchPage: async (page) => {
				const res = await fetch(`https://api.cloudflare.com/client/v4/zones?page=${page}&per_page=50`, {
					headers: authHeaders(fields),
				});
				const body = res.json;
				if (res.status !== 200 || body?.success === false) {
					failAnswer(res, {
						hint: HINT,
						secrets: secretsOf(fields),
						refused: isAuthRefusal(body),
					});
				}
				if (!Array.isArray(body?.result) || typeof body?.result_info?.page !== "number") {
					throw malformed(res, secretsOf(fields));
				}
				return {
					names: body.result.map((zone) => zone?.name),
					more: body.result_info.page < (body.result_info.total_pages ?? 0),
				};
			},
		}),
};
