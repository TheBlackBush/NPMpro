import { GLOBAL_DIR, PAGE_FILES, pageFile } from "./types.js";

// What the nginx templates of a host read about its landing pages: the internal page locations
// (/.npmpro-page/<name>, _npmpro_pages.conf) and, for the host and each custom location, the page name per error and
// whether upstream errors are intercepted. Pure.
//
// - error_page goes into each location, never the server, so the http-level error_page 497 stays inherited and the
//   forward-auth locations keep their own error_page 401 403.
// - The denied page only where an access list refuses something (users or rules) and there is no forward auth: forward
//   auth answers 401 and 403 with its sign-in redirect.
// - A country gate (buildAclFile geo_gates, _geo_gates.conf) refuses outside the location: it rewrites to the internal
//   /.npmpro-geo/<page> location, which answers 403 with the denied page (geo_denied, also under forward auth, whose
//   error_page would turn the 403 into its redirect or challenge) or nginx's own 403 (an empty name). The location's
//   own error_page 401 403 and its intercepting stay as they are, as the gate never answers there.
// - A server level error_page in the host's advanced config stops the page error_page lines of its locations (a
//   location level error_page ends the inheritance of the server's), so the host's own wins and no page is wired.
// - A proxy_intercept_errors of the host's own config (a second flag directive fails nginx -t) replaces ours.
// - proxy_intercept_errors only in http and https locations without an error_page for 401 and 403, so the upstream's
//   own 401 and 403 always pass through (APIs, pass_auth lists, forward auth that would redirect on them).

const INTERCEPT_SCHEMES = new Set(["http", "https"]);

// a custom choice without html has no file (writePlacePages writes none): the global page stands in
const choiceOf = (host, column, fallback) => {
	const choice = host[column] ?? fallback;
	return choice === "custom" && (!host[`${column}_html`] || !validId(host.id)) ? "global" : choice;
};
const validId = (id) => Number.isSafeInteger(id) && id >= 1;

// a directive written in custom nginx config, comment lines ignored
const hasDirective = (name, ...configs) =>
	configs.some((config) =>
		String(config ?? "")
			.split("\n")
			.some((line) => !line.trimStart().startsWith("#") && new RegExp(`\\b${name}\\b`, "u").test(line)),
	);
const NO_PAGES = { not_found: "", upstream_error: "", denied: "", geo_denied: "", intercept: false };
const hasForwardAuth = (item) => !["none", "", undefined, null].includes(item?.npmpro_auth_request);
const refuses = (list) => (list?.items?.length ?? 0) > 0 || (list?.clients?.length ?? 0) > 0;
// a 403 gate; a drop gate closes the connection (444) and needs no page
const gates403 = (list) => (list?.geo_gates ?? []).some((gate) => !gate.drop);

/**
 * @param   {"proxy_host"|"dead_host"|"redirection_host"|"default"} hostType
 * @param   {Object} host  as renderConfig prepared it: access_list built, locations not rendered yet,
 *                         npmpro_certificate_unusable set
 * @returns {{ locations: { name: string, file: string }[], host: Object, byLocation: Object[], geoTargets: string[] }}
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
	const result = (hostPages, locationPages = [], geoTargets = []) => ({
		locations: [...files].map(([name, file]) => ({ name, file })),
		host: hostPages,
		byLocation: locationPages,
		geoTargets,
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

	const ownErrorPage = hasDirective("error_page", host.advanced_config);
	const notFound = ownErrorPage
		? ""
		: use(
				"not-found",
				pageFile("not_found", choiceOf(host, "npmpro_page_not_found", "upstream"), "proxy_host", host.id),
			);
	const upstream = ownErrorPage
		? ""
		: use(
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
	const deniedPage = (accessList) => {
		const deniedChoice = accessList?.denied_page ?? "global";
		return deniedName(
			pageFile(
				"denied",
				deniedChoice === "custom" && !validId(accessList.denied_list_id) ? "global" : deniedChoice,
				"access_list",
				accessList.denied_list_id,
			),
		);
	};
	const pagesOf = (item, accessList, ownIntercept, ownLocationErrorPage) => {
		if (ownErrorPage || ownLocationErrorPage) return NO_PAGES;
		const denied = refuses(accessList) && !hasForwardAuth(item) ? deniedPage(accessList) : "";
		return {
			not_found: notFound,
			upstream_error: upstream,
			denied,
			geo_denied: gates403(accessList) ? deniedPage(accessList) : "",
			intercept:
				INTERCEPT_SCHEMES.has(item.forward_scheme) &&
				Boolean(notFound || upstream) &&
				!denied &&
				!hasForwardAuth(item) &&
				!ownIntercept,
		};
	};
	const own = pagesOf(
		host,
		host.access_list,
		hasDirective("proxy_intercept_errors", host.advanced_config, host.npmpro_location_config),
		hasDirective("error_page", host.npmpro_location_config),
	);
	// a disabled location is not rendered (renderLocations), so it registers no page location either
	const byLocation = (host.locations ?? []).map((location) =>
		location.npmpro_enabled === false
			? NO_PAGES
			: pagesOf(
					location,
					location.access_list,
					hasDirective("proxy_intercept_errors", host.advanced_config, location.advanced_config),
					hasDirective("error_page", location.advanced_config),
				),
	);
	// a page location only stays when a location uses it (its error_page lines may all be left out above)
	const used = new Set([maintenance, certificate]);
	for (const pages of [own, ...byLocation]) {
		for (const name of [pages.not_found, pages.upstream_error, pages.denied, pages.geo_denied]) used.add(name);
	}
	for (const name of files.keys()) if (!used.has(name)) files.delete(name);
	// one /.npmpro-geo/<page> location per page a rendered 403 gate rewrites to ("": nginx's own 403)
	const geoTargets = new Set();
	const gated = [
		[host.access_list, own],
		...(host.locations ?? []).map((location, index) => [
			location.npmpro_enabled === false ? undefined : location.access_list,
			byLocation[index],
		]),
	];
	for (const [accessList, pages] of gated) if (gates403(accessList)) geoTargets.add(pages.geo_denied);
	return result({ ...own, maintenance, certificate }, byLocation, [...geoTargets]);
};
