import { Info } from "lucide-react";
import { StatusAlert } from "./StatusAlert";

/**
 * The lead note under a section's heading: one sentence on what the section does. Not a live region (it is no
 * status change); env-lock and restart notes stay their own StatusAlert under it.
 *
 * @param {Object} props
 * @param {string} props.id     translation id
 * @param {Object} [props.data] its values
 */
function SettingsLead({ id, data }) {
	return <StatusAlert variant="secondary" icon={Info} id={id} data={data} live={false} />;
}

export { SettingsLead };
