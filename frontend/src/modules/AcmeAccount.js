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

export const canRegisterNow = (account) => account?.state !== "registered";

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

export const replaceDefaults = (account) => ({
	email: account?.email ?? "",
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
