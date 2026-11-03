import { createContext, useContext } from "react";
import { cn } from "src/lib/utils";
import { T } from "src/locale";
import { HelpButton } from "src/modals";
import { SECTIONS_WITHOUT_HELP, settingsHelpDoc } from "src/modules/SettingsSections";

// the id of the Settings section on screen (Layout provides it), so its heading opens the section's help document
const SettingsSectionContext = createContext(null);

/**
 * A Settings section's title with a "?" button that opens the section's help document in the help window, as the
 * list pages do, and an actions slot on the right (the Users and Audit Log sections put their buttons there)
 *
 * @param {Object} props
 * @param {string} props.titleId      the title's translation id
 * @param {string} [props.className]  of the row, "mb-4" by default
 * @param {React.ReactNode} [props.actions]  buttons at the end of the row
 */
function SettingsHeading({ titleId, className = "mb-4", actions }) {
	const section = useContext(SettingsSectionContext);
	return (
		<div className={cn("flex flex-wrap items-center gap-2", className)}>
			<h2 className="text-xl font-semibold">
				<T id={titleId} />
			</h2>
			{section && !SECTIONS_WITHOUT_HELP.includes(section) ? <HelpButton doc={settingsHelpDoc(section)} /> : null}
			{actions ? <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
		</div>
	);
}

export { SettingsHeading, SettingsSectionContext };
