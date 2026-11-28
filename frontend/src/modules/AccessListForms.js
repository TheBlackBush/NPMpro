/**
 * The rules of the access list window on React Hook Form: the rows of its basic auth users and access rules (with
 * the blank row and the last "all" rule the window always shows), the validate function and the request a save sends.
 * Pure, so node --test checks them without a DOM.
 */
import { fieldsValidate } from "./HookForm.js";
import { placeDefaults, placeErrors, placePayload } from "./LandingPageForms.js";

// the backend's rules (schema/common.json, internal/access-list.js); bcrypt reads at most 72 bytes
const USERNAME = /^[^:\p{Cc}]{1,255}$/u;
const MAX_PASSWORD_BYTES = 72;
// an address or CIDR range, or unix:; "all" is only the last rule
const ADDRESS = /^(?:unix:|[0-9A-Fa-f.:/]{1,255})$/u;

/**
 * A new basic auth user row
 *
 * @returns {{ username: string, password: string }}
 */
export const blankUser = () => ({ username: "", password: "" });

/**
 * A new access rule row (it goes before the last "all" rule)
 *
 * @returns {{ directive: string, address: string, comment: string }}
 */
export const blankRule = () => ({ directive: "allow", address: "", comment: "" });

/**
 * The user rows the window shows: the saved users (a saved password is never sent back, so it starts empty), or
 * one blank row
 *
 * @param   {Object[]} items  the saved users
 * @returns {Object[]}
 */
export function userRows(items) {
	const rows = items.map(({ username, password }) => ({ username, password: password ?? "" }));
	return rows.length > 0 ? rows : [blankUser()];
}

/**
 * The access rule rows the window shows: the saved rules, ending with the "all" rule (deny unless saved), and at
 * least one row before it
 *
 * @param   {Object[]} clients  the saved rules
 * @returns {Object[]}
 */
export function ruleRows(clients) {
	const rows = clients.map(({ directive, address, npmproComment }) => ({
		directive,
		address,
		comment: npmproComment ?? "",
	}));
	if (rows.at(-1)?.address?.toLowerCase() !== "all") rows.push({ directive: "deny", address: "all", comment: "" });
	return rows.length === 1 ? [blankRule(), ...rows] : rows;
}

const named = (rows) => rows.filter((row) => String(row.username ?? "").trim() !== "");
const withAddress = (rows) => rows.filter((row) => String(row.address ?? "").trim() !== "");
const sameRules = (a, b) =>
	a.length === b.length &&
	a.every(
		(rule, index) =>
			rule.directive === b[index].directive &&
			rule.address === b[index].address &&
			rule.comment.trim() === b[index].comment.trim(),
	);

/**
 * Whether the "block visitors whose country is unknown" switch shows on: a stored "auto" follows the mode (allow
 * only these countries blocks an unknown country, block these countries lets it pass)
 *
 * @param   {string} mode     off, allow or deny
 * @param   {string} unknown  the stored npmproGeoUnknown: auto, pass or block
 * @returns {boolean}
 */
export const unknownSwitchOn = (mode, unknown) => unknown === "block" || (unknown === "auto" && mode === "allow");

/**
 * The npmproGeoUnknown a save sends: the stored one while the mode is off, "auto" when the switch shows what the
 * mode does anyway, else the explicit value. The switch keeps its position when the mode changes, so a list saved
 * with "auto" returns to "auto" when the mode goes allow, deny, allow.
 *
 * @param   {string}  mode      off, allow or deny
 * @param   {boolean} switchOn  the switch
 * @param   {string}  saved     the stored npmproGeoUnknown
 * @returns {string}
 */
export const unknownValue = (mode, switchOn, saved) => {
	if (mode === "off") return saved;
	if (switchOn === (mode === "allow")) return "auto";
	return switchOn ? "block" : "pass";
};

/**
 * What the Countries tab allows. Without a country database (rule 6 of the backend) a save may keep or remove
 * countries or turn the mode off, but not turn a mode on, change it or add a country.
 *
 * @param   {Object}  _values    the form values (the rules need only the saved list)
 * @param   {Object}  saved      the saved list (its npmproGeoMode; a new list has none)
 * @param   {boolean} available  the database is usable (GET /nginx/access-lists/geoip)
 * @returns {{ modeLocked: string[], canAdd: boolean }}  the mode options to disable, whether the picker adds
 */
export const geoRestrictions = (_values, saved, available) =>
	available
		? { modeLocked: [], canAdd: true }
		: { modeLocked: ["allow", "deny"].filter((mode) => mode !== (saved?.npmproGeoMode ?? "off")), canAdd: false };

const countryRows = (items) => items.map(({ country, npmproComment }) => ({ country, comment: npmproComment ?? "" }));

/**
 * The errors of the user rows (blank ones included), one entry per row, or undefined: a username without : and
 * control characters, each once; a password for a new user, at most 72 bytes
 *
 * @param   {Object}      rules  createValidations(intl)
 * @param   {Object[]}    rows
 * @param   {Set<string>} saved  the usernames of the saved list (empty keeps their password)
 * @returns {Array|undefined}
 */
export function userErrors(rules, rows, saved) {
	const seen = new Set();
	const errors = rows.map((row) => {
		const error = {};
		const username = String(row.username ?? "").trim();
		if (username === "") return null;
		if (!USERNAME.test(username)) error.username = rules.message("access-list.username.invalid");
		else if (seen.has(username)) error.username = rules.message("error.access.duplicate-usernames");
		seen.add(username);
		const password = String(row.password ?? "");
		if (password === "" && !saved.has(username)) error.password = rules.message("error.required");
		else if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
			error.password = rules.message("error.max-byte-length", { max: MAX_PASSWORD_BYTES });
		}
		return Object.keys(error).length > 0 ? error : null;
	});
	return errors.some(Boolean) ? errors : undefined;
}

/**
 * The errors of the access rules before the last ("all") one, one entry per row, or undefined
 *
 * @param   {Object}   rules
 * @param   {Object[]} rows
 * @returns {Array|undefined}
 */
export function ruleErrors(rules, rows) {
	const errors = rows.slice(0, -1).map((row) => {
		const address = String(row.address ?? "").trim();
		return address === "" || ADDRESS.test(address)
			? undefined
			: { address: rules.message("access-list.address.invalid") };
	});
	return errors.some(Boolean) ? errors : undefined;
}

/**
 * The starting values of an access list
 *
 * @param   {Object} data
 * @returns {Object}
 */
export const accessListDefaults = (data) => ({
	name: data.name,
	satisfyAny: data.satisfyAny,
	passAuth: data.passAuth,
	items: userRows(data.items),
	clients: ruleRows(data.clients),
	geoMode: data.npmproGeoMode ?? "off",
	countries: countryRows(data.npmproCountries ?? []),
	geoBlockUnknown: unknownSwitchOn(data.npmproGeoMode ?? "off", data.npmproGeoUnknown ?? "auto"),
	geoDrop: data.npmproGeoDrop ?? false,
	...placeDefaults("accessList", data),
});

/**
 * The tabs of the access list window (ModalTabs); the message that asks for a user or a rule shows above them
 */
export const ACCESS_LIST_TABS = Object.freeze([
	{
		id: "details",
		labelId: "column.details",
		fields: ["name", "satisfyAny", "passAuth", "npmproDeniedPage", "npmproDeniedPageHtml"],
	},
	{ id: "auth", labelId: "column.authorizations", fields: ["items"] },
	{ id: "rules", labelId: "column.rules", fields: ["clients"] },
	{
		id: "countries",
		labelId: "access-list.countries",
		fields: ["geoMode", "countries", "geoBlockUnknown", "geoDrop"],
	},
]);

/**
 * Access list: a name of 1 to 255 characters, the user rows, the rule rows, and at least one user or one rule that is
 * not "all" (accessRules, the message at the top of the window)
 *
 * @param   {Object}      rules
 * @param   {Object}      options
 * @param   {Set<string>} options.savedUsers  the usernames of the saved list
 * @returns {Function}
 */
export const accessListValidate = (rules, { savedUsers }) =>
	fieldsValidate({ name: rules.validateString(1, 255) }, (values) => {
		const items = userErrors(rules, values.items, savedUsers);
		const clients = ruleErrors(rules, values.clients);
		const countriesOn = values.geoMode !== "off";
		const noRules =
			named(values.items).length === 0 &&
			!(countriesOn && values.countries.length > 0) &&
			withAddress(values.clients).every((rule) => rule.address.trim().toLowerCase() === "all");
		return {
			...(items ? { items } : {}),
			...(clients ? { clients } : {}),
			...(countriesOn && values.countries.length === 0
				? { countries: rules.message("access-list.countries.required") }
				: {}),
			...(noRules ? { accessRules: rules.message("error.access.at-least-one") } : {}),
			...placeErrors(rules, "accessList", values),
		};
	});

const savedRule = ({ directive, address, npmproComment }) => ({
	directive,
	address,
	npmproComment: npmproComment ?? "",
});
const sentRule = ({ directive, address, comment }) => ({ directive, address, npmproComment: comment.trim() });

/**
 * The request of an access list: the users with a name, the rules with an address. Rules the user did not change
 * are sent as saved (a list saved without the "all" rule keeps it out).
 *
 * @param   {Object}   values
 * @param   {Object[]} savedClients  the saved rules
 * @param   {string}   savedUnknown  the saved npmproGeoUnknown (auto for a new list)
 * @returns {Object}
 */
export function accessListPayload(values, savedClients, savedUnknown = "auto") {
	const rules = withAddress(values.clients);
	const unchanged = sameRules(rules, withAddress(ruleRows(savedClients)));
	return {
		name: values.name,
		satisfyAny: values.satisfyAny,
		passAuth: values.passAuth,
		items: named(values.items).map(({ username, password }) => ({ username, password })),
		clients: unchanged ? savedClients.map(savedRule) : rules.map(sentRule),
		npmproGeoMode: values.geoMode,
		npmproGeoUnknown: unknownValue(values.geoMode, values.geoBlockUnknown, savedUnknown),
		npmproGeoDrop: values.geoDrop,
		npmproCountries: values.countries.map(({ country, comment }) => ({ country, npmproComment: comment.trim() })),
		...placePayload("accessList", {
			npmproDeniedPage: values.npmproDeniedPage,
			npmproDeniedPageHtml: values.npmproDeniedPageHtml,
		}),
	};
}
