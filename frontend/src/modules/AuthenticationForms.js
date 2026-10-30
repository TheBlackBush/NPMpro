/**
 * The rules of Settings > Authentication (OIDC) on React Hook Form: starting values in the order the section shows
 * its fields, the validate function the Formik section had (the same messages), the fields whose message follows
 * another field, and the request. Pure, so node --test checks them without a DOM.
 */
import {
	DEFAULT_OIDC_COLOR,
	isOidcColor,
	isOidcDomain,
	OIDC_MAX_DOMAINS,
	oidcSettingsPayload,
	parseDomains,
} from "./Oidc.js";

// the backend's rules (schema/paths/settings/oidc/put.json, internal/oidc-setting-rules.js)
const ISSUER_URL = /^https:\/\/[^\s/$.?#].[^\s]*$/u;
const REDIRECT_DOMAIN =
	/^(?=.{1,253}(?::[0-9]{1,5})?$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?::[0-9]{1,5})?$/u;
const SCOPES = /^(?=[\x21-\x7e ]*$)(?:.* )?openid(?: .*)?$/u;
const CONNECTION_KEYS = ["issuerUrl", "clientId", "clientSecret", "redirectDomain"];
const PERMISSION_KEYS = ["proxyHosts", "redirectionHosts", "deadHosts", "streams", "accessLists", "certificates"];

/**
 * The fields whose message depends on another field's value: field -> the fields to check again when it changes.
 * The client secret must be entered again once the issuer or the client moves; "Disable password login" may not end
 * on from a password session once the connection is complete and on.
 */
export const AUTHENTICATION_RECHECKS = {
	enabled: ["disablePassword"],
	issuerUrl: ["clientSecret", "disablePassword"],
	clientId: ["clientSecret", "disablePassword"],
	clientSecret: ["disablePassword"],
	redirectDomain: ["disablePassword"],
};

/**
 * The starting values, in the section's order: provider, button, sign-in rules, new users, their permissions
 *
 * @param   {Object} data  GET /settings/oidc
 * @returns {Object}
 */
export const authenticationValues = (data) => ({
	enabled: data.enabled,
	issuerUrl: data.issuerUrl ?? "",
	clientId: data.clientId ?? "",
	clientSecret: "",
	redirectDomain: data.redirectDomain ?? "",
	scopes: data.scopes ?? "",
	buttonLabel: data.button?.label ?? "",
	buttonColor: data.button?.color || DEFAULT_OIDC_COLOR,
	// a built-in icon picked but not saved yet; null keeps the stored icon (uploads save on their own)
	buttonIcon: null,
	requireVerifiedEmail: data.requireVerifiedEmail,
	skipMfa: data.skipMfa,
	disablePassword: data.disablePassword,
	autoCreateEnabled: Boolean(data.autoCreate?.enabled),
	autoCreateDomains: (data.autoCreate?.allowedDomains ?? []).join(", "),
	autoCreatePermissions: {
		visibility: data.autoCreate?.permissions?.visibility ?? "user",
		...Object.fromEntries(PERMISSION_KEYS.map((key) => [key, data.autoCreate?.permissions?.[key] ?? "view"])),
	},
});

/**
 * @param   {Object}   rules     createValidations(intl)
 * @param   {Object}   data      the stored settings (GET /settings/oidc)
 * @param   {Function} isLocked  camelCase key -> locked by env
 * @returns {Function}
 */
export const authenticationValidate = (rules, data, isLocked) => (values) => {
	const errors = {};
	const maxLength = (value, max) =>
		value.length > max ? rules.message("error.max-character-length", { max }) : null;
	const set = (key, message) => {
		if (message && !isLocked(key) && !errors[key]) errors[key] = message;
	};
	const issuerUrl = values.issuerUrl.trim();
	set("issuerUrl", maxLength(issuerUrl, 2048));
	if (issuerUrl && !ISSUER_URL.test(issuerUrl)) {
		set("issuerUrl", rules.message("settings.authentication.issuer-url.invalid"));
	}
	set("clientId", maxLength(values.clientId.trim(), 255));
	set("clientSecret", maxLength(values.clientSecret, 1024));
	const redirectDomain = values.redirectDomain.trim();
	set("redirectDomain", maxLength(redirectDomain, 260));
	if (redirectDomain && !REDIRECT_DOMAIN.test(redirectDomain)) {
		set("redirectDomain", rules.message("settings.authentication.redirect-domain.invalid"));
	}
	const scopes = values.scopes.trim();
	set("scopes", maxLength(scopes, 255));
	if (scopes && !SCOPES.test(scopes)) {
		set("scopes", rules.message("settings.authentication.scopes.invalid"));
	}

	// the saved secret is only sent to the issuer and client it was entered for
	const moved = ["issuerUrl", "clientId"].some(
		(key) => !isLocked(key) && data[key] && values[key].trim() !== data[key],
	);
	if (moved && data.clientSecretSet && !values.clientSecret) {
		set("clientSecret", rules.message("error.oidc-secret-required"));
	}

	// from a password session a save may not end with password login disabled when it was not before
	if (data.sessionAuthMethod !== "oidc") {
		const secretKept = data.clientSecretSet && !data.secretError && !moved;
		const complete = CONNECTION_KEYS.every((key) =>
			key === "clientSecret" ? Boolean(values.clientSecret) || secretKept : Boolean(values[key].trim()),
		);
		const activeAfter = (values.enabled || CONNECTION_KEYS.every(isLocked)) && complete;
		const disabledBefore = Boolean(data.active && data.disablePassword);
		if (!disabledBefore && activeAfter && values.disablePassword) {
			set("disablePassword", rules.message("error.oidc-disable-password-session"));
		}
	}

	if (!isOidcColor(values.buttonColor)) {
		errors.buttonColor = rules.message("settings.authentication.button.color.invalid");
	}
	if (!values.buttonLabel.trim()) {
		errors.buttonLabel = rules.message("settings.authentication.button.label.required");
	}
	const domains = parseDomains(values.autoCreateDomains);
	const invalid = domains.filter((domain) => !isOidcDomain(domain));
	if (invalid.length > 0) {
		errors.autoCreateDomains = rules.message("settings.authentication.allowed-domains.invalid", {
			domains: invalid.join(", "),
		});
	} else if (domains.length > OIDC_MAX_DOMAINS) {
		errors.autoCreateDomains = rules.message("settings.authentication.allowed-domains.too-many", {
			max: OIDC_MAX_DOMAINS,
		});
	}
	return errors;
};

/**
 * The request of a save: the stored settings with the form's values, the button (a built-in icon picked now, else
 * the stored icon) and the new-user defaults; locked keys and an empty secret are left out (oidcSettingsPayload)
 *
 * @param   {Object} values
 * @param   {Object} data  the stored settings
 * @returns {Object}
 */
export const authenticationPayload = (values, data) => {
	const {
		buttonLabel,
		buttonColor,
		buttonIcon,
		autoCreateEnabled,
		autoCreateDomains,
		autoCreatePermissions,
		...rest
	} = values;
	const button = {
		label: buttonLabel.trim(),
		color: buttonColor,
		icon: buttonIcon ? { type: "builtin", name: buttonIcon } : data.button?.icon,
	};
	const autoCreate = {
		enabled: autoCreateEnabled,
		allowedDomains: parseDomains(autoCreateDomains),
		permissions: autoCreatePermissions,
	};
	return oidcSettingsPayload({ ...data, ...rest, autoCreate, button });
};
