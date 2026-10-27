import { IconDownload, IconUpload } from "@tabler/icons-react";
import { useRef } from "react";
import { useNavigate } from "react-router";
import { intl, T } from "src/locale";
import { showExportItemsModal, showImportItemsModal } from "src/modals";
import { MANAGE, VIEW } from "src/modules/Permissions";
import { Button } from "./Button";
import { HasPermission } from "./HasPermission";

/**
 * Export and Import of a list page, for the card header's button list before Add: Export (view permission, when the
 * page has items) opens the export window, Import (manage permission) picks a .npmpro file and opens the import.
 * Below the sm breakpoint both show only their icon.
 *
 * @param {Object}  props
 * @param {string}  props.kind               the page's kind of items: proxy_hosts, redirection_hosts, dead_hosts,
 *                                           streams, certificates, access_lists or dns_credentials
 * @param {string}  props.permissionSection  the permission section of the kind (src/modules/Permissions)
 * @param {boolean} props.hasItems           whether the page lists any items (nothing to export otherwise)
 */
function ImportExportButtons({ kind, permissionSection, hasItems }) {
	const navigate = useNavigate();
	const inputRef = useRef(null);
	const exportLabel = intl.formatMessage({ id: "backup.export" });
	const importLabel = intl.formatMessage({ id: "backup.import" });

	const onFile = (event) => {
		const [file] = event.target.files ?? [];
		// the same file can be chosen again
		event.target.value = "";
		if (file) showImportItemsModal(kind, file, navigate);
	};

	return (
		<>
			{hasItems ? (
				<HasPermission section={permissionSection} permission={VIEW} hideError>
					<Button size="sm" onClick={() => showExportItemsModal(kind)} aria-label={exportLabel}>
						<IconDownload className="icon" aria-hidden="true" />
						<span className="d-none d-sm-inline">
							<T id="backup.export" />
						</span>
					</Button>
				</HasPermission>
			) : null}
			<HasPermission section={permissionSection} permission={MANAGE} hideError>
				<input
					ref={inputRef}
					type="file"
					accept=".npmpro"
					className="d-none"
					tabIndex={-1}
					aria-hidden="true"
					onChange={onFile}
				/>
				<Button size="sm" onClick={() => inputRef.current?.click()} aria-label={importLabel}>
					<IconUpload className="icon" aria-hidden="true" />
					<span className="d-none d-sm-inline">
						<T id="backup.import" />
					</span>
				</Button>
			</HasPermission>
		</>
	);
}

export { ImportExportButtons };
