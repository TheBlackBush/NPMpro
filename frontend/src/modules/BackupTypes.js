/**
 * Helpers of the backup UI: the selection of the type tree and the passphrase check. A category is
 * { id, types: string[] } as returned by GET /api/backups/types, `selected` is the array of selected type ids. Every
 * selection helper returns a new array.
 */

export function categoryState(category, selected) {
	const count = category.types.filter((id) => selected.includes(id)).length;
	if (count === 0) return "none";
	return count === category.types.length ? "all" : "some";
}

// a category that is not fully selected becomes fully selected, otherwise it is cleared
export function toggleCategory(category, selected) {
	if (categoryState(category, selected) === "all") {
		return selected.filter((id) => !category.types.includes(id));
	}
	return [...selected, ...category.types.filter((id) => !selected.includes(id))];
}

export function toggleType(typeId, selected) {
	return selected.includes(typeId) ? selected.filter((id) => id !== typeId) : [...selected, typeId];
}

export function DEFAULT_SELECTED(categories) {
	return categories.flatMap((category) => category.types);
}

// the categories limited to these type ids, without the ones left empty (a restore offers only the file's types)
export function categoriesOf(categories, typeIds) {
	return categories
		.map((category) => ({ ...category, types: category.types.filter((id) => typeIds.includes(id)) }))
		.filter((category) => category.types.length > 0);
}

export const PASSPHRASE_MIN_LENGTH = 12;

/**
 * Field errors of the passphrase inputs as translation ids, only when secrets are included. The length counts
 * characters (code points) like the API's minLength.
 */
export function passphraseErrors({ secrets, passphrase, passphraseRepeat }) {
	if (!secrets) return {};
	const errors = {};
	if ([...passphrase].length < PASSPHRASE_MIN_LENGTH) errors.passphrase = "settings.backup.passphrase.too-short";
	if (passphraseRepeat !== passphrase) errors.passphraseRepeat = "settings.backup.passphrase.mismatch";
	return errors;
}

/**
 * What a backup holds, for its badges: a category when all its types are in it, else its types one by one. Types
 * that no category knows are listed at the end.
 *
 * @returns {Array<{ kind: "category" | "type", id: string }>}
 */
export function contentLabels(categories, typeIds) {
	const known = categories.flatMap((category) => category.types);
	const labels = categories.flatMap((category) => {
		const present = category.types.filter((id) => typeIds.includes(id));
		if (present.length === 0) return [];
		if (present.length === category.types.length) return [{ kind: "category", id: category.id }];
		return present.map((id) => ({ kind: "type", id }));
	});
	return [...labels, ...typeIds.filter((id) => !known.includes(id)).map((id) => ({ kind: "type", id }))];
}

// backup errors whose English message carries details the translation leaves out (the nginx output, the reason an
// archive is refused, the name of the automatic backup to restore by hand)
const DETAILED_ERRORS = new Set([
	"backup.error.nginx-failed",
	"backup.error.invalid-archive",
	"backup.error.rollback-failed",
]);

/**
 * An API error (src/api/backend/base.js) of these codes with its message as the output that ApiErrorContent offers
 * behind "Show details"; any other error as it is.
 */
export function withErrorDetails(err) {
	const apiError = err?.payload?.error;
	if (!DETAILED_ERRORS.has(apiError?.message_i18n) || apiError.output || !apiError.message) return err;
	return Object.assign(new Error(err.message), {
		payload: { ...err.payload, error: { ...apiError, output: apiError.message } },
	});
}

/**
 * Why a restore cannot start yet, a translation id or null. shown: the type ids the tree shows (null while the types
 * are not loaded), so a restore never replaces a part the user did not see ticked.
 *
 * @param {Object}        state
 * @param {string[]}      state.selected
 * @param {string[]|null} state.shown
 * @param {boolean}       [state.partsFailed]  the types could not be loaded
 * @param {boolean}       [state.checkFailed]  the check of the selection failed
 * @param {boolean}       [state.stale]        the check of the selection is still running
 * @param {boolean}       [state.confirmed]
 */
export function restoreBlockReason({
	selected,
	shown,
	partsFailed = false,
	checkFailed = false,
	stale = false,
	confirmed = false,
}) {
	if (shown === null)
		return partsFailed ? "settings.backup.reason.parts-failed" : "settings.backup.reason.parts-loading";
	if (selected.some((id) => !shown.includes(id))) return "settings.backup.reason.parts-failed";
	if (selected.length === 0) return "settings.backup.reason.no-restore-types";
	if (checkFailed) return "settings.backup.reason.check-failed";
	if (stale) return "settings.backup.reason.checking";
	if (!confirmed) return "settings.backup.reason.confirm";
	return null;
}
