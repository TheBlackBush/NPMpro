import { ErrorAlert, Loading } from "src/components";
import { SettingsHeading } from "./SettingsHeading";

/**
 * A Settings section that loads its data first: the heading with the error or a spinner, then the form
 *
 * @param {Object}   props
 * @param {string}   props.titleId    the heading's translation id
 * @param {*}        [props.error]    the read error, shown instead of the form
 * @param {boolean}  props.isPending  true while a read is still running
 * @param {Function} props.children   () => the form, rendered once the data is there
 */
export function SettingsForm({ titleId, error, isPending, children }) {
	if (error || isPending) {
		return (
			<div className="space-y-4">
				<SettingsHeading titleId={titleId} />
				{error ? <ErrorAlert error={error} /> : <Loading noLogo />}
			</div>
		);
	}
	return children();
}
