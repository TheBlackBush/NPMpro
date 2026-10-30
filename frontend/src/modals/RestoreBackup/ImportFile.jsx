import { intl, T } from "src/locale";

// the largest file a page import takes (the API refuses larger ones with 413)
export const MAX_IMPORT = 200 * 1024 ** 2;

// the backup category of each page kind, for its box icon
const KIND_CATEGORIES = {
	proxy_hosts: "hosts",
	redirection_hosts: "hosts",
	dead_hosts: "hosts",
	streams: "hosts",
	certificates: "certificates",
	access_lists: "access_lists",
	dns_credentials: "dns_credentials",
};

/**
 * The type box of a page import: only the page's kind, named by its type (the linked certificates, access lists and
 * DNS credentials come along with the items that need them and are not selected themselves)
 *
 * @param   {string}  kind
 * @returns {Array<{ id: string, types: string[], labelId: string }>}
 */
export function importCategories(kind) {
	return [{ id: KIND_CATEGORIES[kind] ?? kind, types: [kind], labelId: `settings.backup.type.${kind}` }];
}

// the error of a file over the import limit, in the shape ErrorAlert shows
export const tooLargeError = () => new Error(intl.formatMessage({ id: "backup.import.too-large" }));

// whether an upload error is the size limit (the API's too-large, or a 413 of nginx)
export const isTooLarge = (err) => err?.payload?.error?.message_i18n === "backup.error.too-large";

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
			<div className="progress progress-sm progress-brand">
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
