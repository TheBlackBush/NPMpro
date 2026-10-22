/**
 * Returns the translation id explaining why a proxy option is unavailable for the forward scheme,
 * or null if the option can be used. Matches the disabled state of the option toggles.
 */
const getOptionHintId = (option, scheme) => {
	switch (option) {
		case "npmplusProxyRequestBuffering":
		case "npmplusProxyResponseBuffering":
			return ["http", "https"].includes(scheme) ? null : "host.flags.hint.http-only";
		case "npmplusUpstreamCompression":
			return ["path", "empty"].includes(scheme) ? "host.flags.hint.not-path" : null;
		case "npmplusFancyindex":
			return scheme === "path" ? null : "host.flags.hint.path-only";
		default:
			return null;
	}
};

const schemeDependentOptions = [
	"npmplusProxyRequestBuffering",
	"npmplusProxyResponseBuffering",
	"npmplusUpstreamCompression",
	"npmplusFancyindex",
];

/**
 * Returns the enabled options that a change to the forward scheme switches off
 */
const getOptionsResetByScheme = (values, scheme) =>
	scheme === "empty"
		? []
		: schemeDependentOptions.filter((option) => values[option] && getOptionHintId(option, scheme));

export { getOptionHintId, getOptionsResetByScheme };
