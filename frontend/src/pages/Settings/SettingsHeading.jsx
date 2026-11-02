import cn from "clsx";
import { createContext, useContext } from "react";
import { T } from "src/locale";
import { HelpButton } from "src/modals";
import { settingsHelpDoc } from "src/modules/SettingsSections";

// the id of the Settings section on screen (Layout provides it), so its heading opens the section's help document
const SettingsSectionContext = createContext(null);

/**
 * A Settings section's title with a "?" button at the end of the row that opens the section's help document in the
 * help window, as the list pages do
 *
 * @param {Object} props
 * @param {string} props.titleId      the title's translation id
 * @param {string} [props.className]  of the row, "mb-3" by default
 */
function SettingsHeading({ titleId, className = "mb-3" }) {
	const section = useContext(SettingsSectionContext);
	return (
		<div className={cn("d-flex align-items-center gap-2", className)}>
			<h2 className="mb-0">
				<T id={titleId} />
			</h2>
			{section ? <HelpButton doc={settingsHelpDoc(section)} className="ml-auto" /> : null}
		</div>
	);
}

export { SettingsHeading, SettingsSectionContext };
