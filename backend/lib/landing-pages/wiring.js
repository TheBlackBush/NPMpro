import { GLOBAL_DIR, PAGE_FILES, pageFile } from "./types.js";

// What the nginx templates of a host read about its landing pages: the internal page locations
// (/.npmpro-page/<name>, _npmpro_pages.conf) and, for the host and each custom location, the page name per error and
// whether upstream errors are intercepted. Pure.
//
// - error_page goes into each location, never the server, so the http-level error_page 497 stays inherited and the
//   forward-auth locations keep their own error_page 401 403.
// - The denied page only where an access list refuses something (users or rules) and there is no forward auth: forward
//   auth answers 401 and 403 with its sign-in redirect.
// - proxy_intercept_errors only in http and https locations without an error_page for 401 and 403, so the upstream's
//   own 401 and 403 always pass through (APIs, pass_auth lists, forward auth that would redirect on them).

const INTERCEPT_SCHEMES = new Set(["http", "https"]);

// a custom choice without html has no file (writePlacePages writes none): the global page stands in
const choiceOf = (host, column, fallback) => {
	const choice = host[column] ?? fallback;
	return choice === "custom" && !host[`${column}_html`] ? "global" : choice;
};
const hasForwardAuth = (item) => !["none", "", undefined, null].includes(item?.npmpro_auth_request);
const refuses = (list) => (list?.items?.length ?? 0) > 0 || (list?.clients?.length ?? 0) > 0;

/**
 * @param   {"proxy_host"|"dead_host"|"redirection_host"|"default"} hostType
 * @param   {Object} host  as renderConfig prepared it: access_list built, locations not rendered yet,
 *                         npmpro_certificate_unusable set
 * @returns {{ locations: { name: string, file: string }[], host: Object, byLocation: Object[] }}
 */
export const pageWiring = (hostType, host) => {
	const files = new Map();
	const use = (name, file) => {
		if (!file) return "";
		files.set(name, file);
		return name;
	};
	const certificate =
		host.npmpro_certificate_unusable === true && host.ssl_forced === true
			? use("certificate", `${GLOBAL_DIR}/${PAGE_FILES.certificate}`)
			: "";
	const result = (own, byLocation = []) => ({
		locations: [...files].map(([name, file]) => ({ name, file })),
		host: own,
		byLocation,
	});

	if (hostType === "default") return result({ not_found: use("not-found", `${GLOBAL_DIR}/${PAGE_FILES.not_found}`) });
	if (hostType === "dead_host") {
		return result({
			not_found: use(
				"not-found",
				pageFile("not_found", choiceOf(host, "npmpro_page", "global"), "dead_host", host.id),
			),
			certificate,
		});
	}
	if (hostType !== "proxy_host") return result({ certificate });

	const notFound = use(
		"not-found",
		pageFile("not_found", choiceOf(host, "npmpro_page_not_found", "upstream"), "proxy_host", host.id),
	);
	const upstream = use(
		"upstream-error",
		pageFile("upstream_error", choiceOf(host, "npmpro_page_upstream", "global"), "proxy_host", host.id),
	);
	const maintenance = host.npmpro_maintenance
		? use(
				"maintenance",
				pageFile("maintenance", choiceOf(host, "npmpro_page_maintenance", "global"), "proxy_host", host.id),
			)
		: "";
	let denials = 0;
	const deniedName = (file) => {
		if (!file) return "";
		const known = [...files].find(([name, path]) => name.startsWith("denied-") && path === file);
		if (known) return known[0];
		denials += 1;
		return use(`denied-${denials}`, file);
	};
	const pagesOf = (item, accessList) => {
		const denied =
			refuses(accessList) && !hasForwardAuth(item)
				? deniedName(
						pageFile(
							"denied",
							accessList.denied_page ?? "global",
							"access_list",
							accessList.denied_list_id,
						),
					)
				: "";
		return {
			not_found: notFound,
			upstream_error: upstream,
			denied,
			intercept:
				INTERCEPT_SCHEMES.has(item.forward_scheme) &&
				Boolean(notFound || upstream) &&
				!denied &&
				!hasForwardAuth(item),
		};
	};
	const own = pagesOf(host, host.access_list);
	const byLocation = (host.locations ?? []).map((location) => pagesOf(location, location.access_list));
	return result({ ...own, maintenance, certificate }, byLocation);
};
