import { intl, T } from "src/locale";

// the largest file a page import takes (the API refuses larger ones with 413)
export const MAX_IMPORT = 200 * 1024 ** 2;

// the kinds a page import brings along with its items, as the API merges them
const LINKED_KINDS = ["certificates", "access_lists", "dns_credentials"];

// the backup categories of the page kinds (GET /api/backups/types is for administrators only)
const PAGE_CATEGORIES = [
	{ id: "hosts", types: ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams"] },
	{ id: "certificates", types: ["certificates"] },
	{ id: "access_lists", types: ["access_lists"] },
	{ id: "dns_credentials", types: ["dns_credentials"] },
];

/**
 * The types a page import merges: the page's kind and the linked kinds, those the file holds
 *
 * @param   {string}    kind
 * @param   {string[]}  fileTypes  the types of the file's manifest
 * @returns {string[]}
 */
export function importTypes(kind, fileTypes) {
	return [kind, ...LINKED_KINDS.filter((typeId) => typeId !== kind)].filter((typeId) => fileTypes.includes(typeId));
}

/**
 * The categories of the import's types, for the type boxes of the merge view
 *
 * @param   {string[]}  types  importTypes()
 * @returns {Array<{ id: string, types: string[] }>}
 */
export function importCategories(types) {
	return PAGE_CATEGORIES.map((category) => ({
		...category,
		types: category.types.filter((typeId) => types.includes(typeId)),
	})).filter((category) => category.types.length > 0);
}

// the error of a file over the import limit, in the shape ErrorAlert shows
export const tooLargeError = () => new Error(intl.formatMessage({ id: "backup.import.too-large" }));

/**
 * The upload of the import file and its progress (Cancel in the footer stops it)
 *
 * @param {Object}   props
 * @param {number}   props.progress  0 to 1
 */
export function Uploading({ progress }) {
	const percent = Math.round(progress * 100);
	return (
		<div className="py-3">
			<div className="text-secondary mb-2" role="status">
				<T id="settings.backup.uploading" data={{ percent }} />
			</div>
			<div className="progress progress-sm">
				<div
					className="progress-bar"
					style={{ width: `${percent}%` }}
					role="progressbar"
					aria-valuenow={percent}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-label={intl.formatMessage({ id: "backup.import" })}
				/>
			</div>
		</div>
	);
}
