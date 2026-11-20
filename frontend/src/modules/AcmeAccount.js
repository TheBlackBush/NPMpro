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

export const accountOf = (data, server) => (data.accounts ?? []).find((account) => account.server === server) ?? null;

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
		errors.customUrl = rules.message("error.acme-url");
	}
	const email = values.email.trim();
	if (email !== (data.email ?? "") && email !== "" && !EMAIL.test(email)) {
		errors.email = rules.message("error.invalid-email");
	}
	return errors;
};

const FIELD_OF_PREFIX = { server: "customUrl", email: "email", eab: "eabKid" };
const PREFIXED = /^(?<prefix>server|email|eab): (?<text>.*)$/su;

/**
 * A failed save: the backend names a field by a prefix of its English message ("server: ..."); the translated text
 * may carry it too. Returns the message without the prefix and the form field it belongs to (null: a general error)
 */
export function saveFailureOf(raw, message) {
	const fromRaw = PREFIXED.exec(raw ?? "");
	const fromMessage = PREFIXED.exec(message ?? "");
	const prefix = (fromRaw ?? fromMessage)?.groups.prefix;
	return {
		message: fromMessage ? fromMessage.groups.text : message,
		field: prefix ? FIELD_OF_PREFIX[prefix] : null,
	};
}

/** The env var that locks one key of the EAB pair: the pair is locked together, so either name serves both fields */
export const eabLockEnv = (lockedBy, key) => {
	const other = key === "eabKid" ? "eabHmacKey" : "eabKid";
	return lockedBy?.[key] ?? lockedBy?.[other];
};
