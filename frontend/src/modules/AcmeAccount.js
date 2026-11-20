// The ACME account card of Settings, Certificates and the Replace account window: presets, form values, payload,
// which fields show, the state line and the profile choices. Pure, so node --test checks it without a DOM.

export const CUSTOM = "custom";
export const ACME_PRESETS = [
	{ id: "letsencrypt", server: "https://acme-v02.api.letsencrypt.org/directory", eab: false },
	{ id: "letsencrypt-staging", server: "https://acme-staging-v02.api.letsencrypt.org/directory", eab: false },
	{ id: "zerossl", server: "https://acme.zerossl.com/v2/DV90", eab: true },
	{ id: "google", server: "https://dv.acme-v02.api.pki.goog/directory", eab: true },
];
const EAB_PRESETS = new Set(ACME_PRESETS.filter((preset) => preset.eab).map((preset) => preset.id));
const SNAKE = /_(?<c>[a-z])/gu;
const DIRECTORY_URL = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~/-]*)?$/u;
const EMAIL = /^[^\s@]+@[^\s@]+$/u;
const QUERY_OR_FRAGMENT = /[?#]/u;

export const presetOf = (server) => ACME_PRESETS.find((preset) => preset.server === server)?.id ?? CUSTOM;

export function acmeServerLabel(server) {
	const id = ACME_PRESETS.find((preset) => preset.server === server)?.id;
	if (id) return { labelId: `acme.preset.${id}` };
	try {
		return { text: new URL(server).host };
	} catch {
		return { text: String(server) };
	}
}

export function lockedSet(locked) {
	const set = new Set((locked ?? []).map((key) => key.replace(SNAKE, (...m) => m.at(-1).c.toUpperCase())));
	if (set.has("eabKid") || set.has("eabHmacKey")) {
		set.add("eabKid");
		set.add("eabHmacKey");
	}
	return set;
}

export function toAcmeForm(data) {
	const preset = presetOf(data.server);
	return {
		preset,
		customUrl: preset === CUSTOM ? data.server : "",
		email: data.email ?? "",
		eabKid: "",
		eabHmacKey: "",
	};
}

export const serverOfForm = (values) =>
	values.preset === CUSTOM
		? values.customUrl.trim()
		: ACME_PRESETS.find((preset) => preset.id === values.preset).server;

export function acmePayload(values, data) {
	const locked = lockedSet(data.locked);
	const out = {};
	const server = serverOfForm(values);
	if (!locked.has("server") && server !== data.server) out.server = server;
	if (!locked.has("email") && values.email.trim() !== (data.email ?? "")) out.email = values.email.trim();
	if (!locked.has("eabKid") && values.eabKid.trim() !== "") out.eabKid = values.eabKid.trim();
	if (!locked.has("eabHmacKey") && values.eabHmacKey.trim() !== "") out.eabHmacKey = values.eabHmacKey.trim();
	return out;
}

const SCHEME_AND_HOST = /^(?<scheme>[A-Za-z]+:\/\/)(?<host>[^/?#]*)/u;

// a CA URL with its scheme and host in lower case (the backend's rule: the path keeps its case)
const lowerHost = (server) =>
	typeof server === "string"
		? server.replace(SCHEME_AND_HOST, (_, scheme, host) => `${scheme.toLowerCase()}${host.toLowerCase()}`)
		: server;

export const accountOf = (data, server) => {
	const wanted = lowerHost(server);
	return (data.accounts ?? []).find((account) => lowerHost(account.server) === wanted) ?? null;
};

/**
 * The email the window shows for a CA picked in its select: the env value while ACME_EMAIL locks it, else the email of
 * that CA's account, else none. What is shown is what Connect applies.
 */
export const emailForCa = (data, server) =>
	lockedSet(data.locked).has("email") ? (data.email ?? "") : (accountOf(data, server)?.email ?? "");

export const eabShown = ({ preset, externalAccountRequired, account }) =>
	account?.state !== "registered" && (externalAccountRequired === true || EAB_PRESETS.has(preset));

export function acmeState(account) {
	if (!account) return { kind: "none" };
	if (account.state === "registered") {
		return {
			kind: "registered",
			date: account.registeredOn,
			email: account.email || null,
			error: account.error ?? null,
		};
	}
	if (account.state === "pending") return { kind: "pending", error: account.error ?? null };
	return { kind: "failed", date: account.modifiedOn, error: account.error ?? null };
}

// the buttons of the status card per state, in order; a registered account's Replace account lives in the more menu
const CARD_BUTTONS = {
	registered: [{ key: "change", primary: false }],
	pending: [
		{ key: "retry", primary: false },
		{ key: "change", primary: false },
	],
	failed: [
		{ key: "change", primary: true },
		{ key: "retry", primary: false },
	],
	none: [{ key: "connect", primary: true }],
};

export const cardButtons = (kind) => CARD_BUTTONS[kind];

/**
 * What Connect does with the window's values: nothing (a registered account without a change), a register (a stored
 * account that is not registered and has nothing new to send) or a save (the values changed)
 */
export function connectPlan(values, data) {
	if (Object.keys(acmePayload(values, data)).length > 0) return "save";
	return accountOf(data, serverOfForm(values))?.state === "registered" ? "nothing" : "register";
}

/** Whether the CA's directory is read before Connect saves: a changed CA or one without a registered account */
export function connectNeedsCheck(values, data) {
	if (connectPlan(values, data) === "nothing") return false;
	const server = serverOfForm(values);
	return server !== data.server || accountOf(data, server)?.state !== "registered";
}

/** The outcome of a save or a register answer: "waiting" (stored, connects at the next request) or "connected" */
export const connectOutcome = (result) => (result?.warning === "unreachable" ? "waiting" : "connected");

/** Whether the directory read of a CA answered */
export const directoryReachable = (result) => result?.reachable === true;

/**
 * Whether the window cannot tell if a custom CA needs EAB keys: its directory could not be read (and the account is
 * not registered yet, a registered one needs no keys)
 */
export const directoryUnreadable = ({ custom, probed, error, result, account }) =>
	account?.state !== "registered" &&
	custom &&
	probed &&
	(Boolean(error) || (result !== undefined && !directoryReachable(result)));

/** The values with the EAB pair emptied while its fields are hidden: typed and then hidden keys are not sent */
export const visibleEabValues = (values, showEab) => (showEab ? values : { ...values, eabKid: "", eabHmacKey: "" });

const CUT_LENGTH = 60;

/** Whether a CA message needs Show details: several lines or longer than what a one-line box holds */
export const messageIsCut = (message) => message.includes("\n") || message.length > CUT_LENGTH;

export function profileChoices({ result, stored }) {
	if (!(result?.reachable && result.directory)) return { mode: "text" };
	const options = [
		{ value: "", labelId: "settings.certificates.profile.placeholder" },
		...result.profiles.map((profile) => ({
			value: profile.name,
			label: profile.name,
			description: profile.description,
		})),
	];
	if (stored && !options.some((option) => option.value === stored)) {
		options.push({ value: stored, label: stored, missing: true });
	}
	return { mode: "select", options };
}

// a locked email (ACME_EMAIL) is the one the new account is registered with, the backend takes only a sent value
export const replaceDefaults = (account, data) => ({
	email: lockedSet(data?.locked).has("email") ? (data.email ?? "") : (account?.email ?? ""),
	eabKid: "",
	eabHmacKey: "",
	deactivateOld: false,
});

export function replacePayload(server, values) {
	const out = { server, email: values.email.trim(), deactivateOld: values.deactivateOld === true };
	if (values.eabKid.trim() && values.eabHmacKey.trim()) {
		out.eabKid = values.eabKid.trim();
		out.eabHmacKey = values.eabHmacKey.trim();
	}
	return out;
}

/** The card's checks, only on values that differ from the saved ones (rule 2) */
export const acmeFormValidate = (rules, data) => (values) => {
	const errors = {};
	const url = values.customUrl.trim();
	if (values.preset === CUSTOM && url !== data.server && !DIRECTORY_URL.test(url)) {
		const withQuery = url.startsWith("https://") && QUERY_OR_FRAGMENT.test(url);
		errors.customUrl = rules.message(withQuery ? "error.acme-url-query" : "error.acme-url");
	}
	const email = values.email.trim();
	if (email !== (data.email ?? "") && email !== "" && !EMAIL.test(email)) {
		errors.email = rules.message("error.invalid-email");
	}
	return errors;
};

const FIELD_OF_PREFIX = { server: "customUrl", email: "email", eab: "eabKid" };
const PREFIXED = /^(?<prefix>server|email|eab): (?<text>.*)$/su;
// a CA's refusal about the external account binding (Pebble: "external account binding JWS verification error" or
// "the field 'kid' references a key that is not known to the ACME server")
const ABOUT_EAB = /external ?account ?binding|\beab\b|\bkid\b|\bhmac\b|unauthorized/iu;

/**
 * A failed save: the backend names a field by a prefix of its English message ("server: ..."); the translated text
 * may carry it too. Without a prefix, a message about the external account binding (or an unauthorized one) while an
 * EAB pair was sent marks the key ID field. Returns the message without the prefix and the form field it belongs to
 * (null: a general error)
 *
 * @param {string}  raw      the message of the answer
 * @param {string}  message  the translated message
 * @param {Object}  [options]
 * @param {boolean} [options.eabSent]  the request carried an EAB pair
 */
export function saveFailureOf(raw, message, { eabSent = false } = {}) {
	const fromRaw = PREFIXED.exec(raw ?? "");
	const fromMessage = PREFIXED.exec(message ?? "");
	const prefix = (fromRaw ?? fromMessage)?.groups.prefix;
	const aboutEab = eabSent && (ABOUT_EAB.test(raw ?? "") || ABOUT_EAB.test(message ?? ""));
	const field = prefix ? FIELD_OF_PREFIX[prefix] : null;
	return { message: fromMessage ? fromMessage.groups.text : message, field: field ?? (aboutEab ? "eabKid" : null) };
}

/** The CA's own sentence of a refusal (error.acme-refused, message_values.message) for the refused box, else the shown message */
export const refusalText = (apiError, shown) => {
	const own = apiError?.message_i18n === "error.acme-refused" ? apiError.message_values?.message : undefined;
	return typeof own === "string" && own !== "" ? own : shown;
};

/** The env var that locks one key of the EAB pair: the pair is locked together, so either name serves both fields */
export const eabLockEnv = (lockedBy, key) => {
	const other = key === "eabKid" ? "eabHmacKey" : "eabKid";
	return lockedBy?.[key] ?? lockedBy?.[other];
};
