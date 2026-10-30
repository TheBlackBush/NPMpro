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
 * The fields a change of a proxy option sets, on a proxy host or a custom location (as both Formik forms did): a
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
	if (name === "npmproAuthRequest" && value === "none") changes.npmproAuthRequestUpstream = "";
	return changes;
};

export { getOptionHintId, getOptionsResetByScheme, proxyOptionChanges };
