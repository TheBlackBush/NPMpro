/**
 * Returns the translation id explaining why a proxy option is unavailable for the forward scheme,
 * or null if the option can be used. Matches the disabled state of the option toggles.
 */
const getOptionHintId = (option, scheme) => {
	switch (option) {
		case "npmproProxyRequestBuffering":
		case "npmproProxyResponseBuffering":
			return ["http", "https"].includes(scheme) ? null : "host.flags.hint.http-only";
		case "npmproUpstreamCompression":
			return ["path", "empty"].includes(scheme) ? "host.flags.hint.not-path" : null;
		case "npmproFancyindex":
			return scheme === "path" ? null : "host.flags.hint.path-only";
		default:
			return null;
	}
};

const schemeDependentOptions = [
	"npmproProxyRequestBuffering",
	"npmproProxyResponseBuffering",
	"npmproUpstreamCompression",
	"npmproFancyindex",
];

/**
 * Returns the enabled options that a change to the forward scheme switches off
 */
const getOptionsResetByScheme = (values, scheme) =>
	scheme === "empty"
		? []
		: schemeDependentOptions.filter((option) => values[option] && getOptionHintId(option, scheme));

/**
 * The fields a change of a proxy option sets, on a proxy host or a custom location: a
 * scheme switches off the options it cannot use, CrowdSec AppSec off turns request buffering off and request
 * buffering on turns AppSec on, no auth request empties its upstream
 *
 * @param   {string} name   the changed field
 * @param   {*}      value
 * @returns {Object} name -> value, the changed field first
 */
const proxyOptionChanges = (name, value) => {
	const changes = { [name]: value };
	if (name === "forwardScheme" && value !== "empty") {
		for (const option of schemeDependentOptions) {
			if (getOptionHintId(option, value)) changes[option] = false;
		}
	}
	if (name === "npmproCrowdsecAppsec" && value === false) changes.npmproProxyRequestBuffering = false;
	if (name === "npmproProxyRequestBuffering" && value === true) changes.npmproCrowdsecAppsec = true;
	if (name === "npmproAuthRequest" && !hasOwnUpstream(value)) changes.npmproAuthRequestUpstream = "";
	return changes;
};

// the forward schemes of a proxy host and of a custom location, in the select's order (labelId: a translated label)
const FORWARD_SCHEME_OPTIONS = Object.freeze([
	{ value: "http", label: "http://" },
	{ value: "https", label: "https://" },
	{ value: "path", labelId: "host.forward-scheme.path" },
	{ value: "empty", labelId: "host.forward-scheme.empty" },
	{ value: "grpc", label: "grpc://" },
	{ value: "grpcs", label: "grpcs://" },
]);

const X_FRAME_OPTIONS = Object.freeze(["SAMEORIGIN", "DENY", "none", "upstream"]);

// the location's own choice to use the host's Auth Request and upstream (backend value "global")
const SAME_AS_HOST = Object.freeze({ value: "global", labelId: "host.auth-request.global" });

const AUTH_REQUEST_OPTIONS = Object.freeze([
	{ value: "none", label: "none" },
	{ value: "anubis", label: "anubis" },
	{ value: "tinyauth", label: "tinyauth" },
	{ value: "oauth2proxy", label: "oauth2proxy" },
	{ value: "voidauth", label: "voidauth" },
	{ value: "authelia", label: "authelia (modern)" },
	{ value: "authentik", label: "authentik" },
	{ value: "authentik-send-basic-auth", label: "authentik-send-basic-auth" },
]);

/**
 * The Auth Request choices: a custom location offers Same as host first
 *
 * @param   {Object}  options
 * @param   {boolean} options.location  the choices of a custom location
 * @returns {Object[]} { value, label | labelId }
 */
const authRequestOptions = ({ location }) =>
	location ? [SAME_AS_HOST, ...AUTH_REQUEST_OPTIONS] : AUTH_REQUEST_OPTIONS;

/**
 * Whether the value has an upstream field of its own (not none, not Same as host)
 *
 * @param   {string} value
 * @returns {boolean}
 */
const hasOwnUpstream = (value) => !["none", "global"].includes(value ?? "none");

/**
 * The Auth Request that applies to a row: Same as host takes the host's
 *
 * @param   {string} hostValue  the host's Auth Request
 * @param   {string} rowValue   the row's Auth Request
 * @returns {string}
 */
const effectiveAuthRequest = (hostValue, rowValue) =>
	rowValue === "global" ? (hostValue ?? "none") : (rowValue ?? "none");

// the option switches in the order they show, with their labels
const OPTION_SWITCHES = [
	["npmproNoindex", "host.flags.send-noindex"],
	["npmproCrowdsecAppsec", "host.flags.disable-crowdsec-appsec"],
	["npmproProxyRequestBuffering", "host.flags.disable-request-buffering"],
	["npmproProxyResponseBuffering", "host.flags.disable-response-buffering"],
	["npmproUpstreamCompression", "host.flags.upstream-compression"],
	["npmproFancyindex", "host.flags.fancyindex"],
];

/**
 * The option switches of a proxy host or of a custom location (ProxyOptionsFields): each with its label, its hints
 * (what it is linked to, why the scheme rules it out) and whether the scheme rules it out
 *
 * @param   {Object}  values  forwardScheme and npmproProxyRequestBuffering of the host or the row
 * @returns {{ name: string, labelId: string, hintIds: string[], disabled: boolean }[]}
 */
const proxyOptionRows = (values) =>
	OPTION_SWITCHES.map(([name, labelId]) => {
		const schemeHintId = getOptionHintId(name, values.forwardScheme);
		const hintIds = [];
		if (name === "npmproCrowdsecAppsec" && values.npmproProxyRequestBuffering) {
			hintIds.push("host.flags.hint.appsec-request-buffering");
		}
		if (name === "npmproProxyRequestBuffering") hintIds.push("host.flags.hint.request-buffering-appsec");
		if (schemeHintId) hintIds.push(schemeHintId);
		return { name, labelId, hintIds, disabled: schemeHintId !== null };
	});

/**
 * A field of the proxy options under a row's path ("locations.2" -> locations.2.forwardScheme), or of the host
 *
 * @param   {string} base   the row's path, "" for the host
 * @param   {string} field
 * @returns {string}
 */
const optionField = (base, field) => (base ? `${base}.${field}` : field);

/**
 * The id of a proxy options control: the field, with the row's key for a custom location (forwardScheme-<key>)
 *
 * @param   {string} field
 * @param   {string} [suffix]  the row's key, "" for the host
 * @returns {string}
 */
const optionId = (field, suffix = "") => (suffix ? `${field}-${suffix}` : field);

export {
	AUTH_REQUEST_OPTIONS,
	authRequestOptions,
	effectiveAuthRequest,
	FORWARD_SCHEME_OPTIONS,
	getOptionHintId,
	getOptionsResetByScheme,
	hasOwnUpstream,
	optionField,
	optionId,
	proxyOptionChanges,
	proxyOptionRows,
	X_FRAME_OPTIONS,
};
