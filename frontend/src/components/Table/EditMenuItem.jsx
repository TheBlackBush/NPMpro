import { Eye, Pencil } from "lucide-react";
import { Button } from "src/components/ui/button";
import { useCanManage } from "src/hooks";
import { T } from "src/locale";

/**
 * The first entry of a host or access list row menu: Edit, or View for a user who may only view the section (the
 * window then opens as a View window, UX-17). A plain button that fills its menu, until the pages move to RowActions.
 *
 * @param {Object}   props
 * @param {string}   props.section  Permissions.js PROXY_HOSTS, ...
 * @param {Function} props.onClick
 */
export function EditMenuItem({ section, onClick }) {
	const canManage = useCanManage(section);
	const Icon = canManage ? Pencil : Eye;
	return (
		<Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={onClick}>
			<Icon data-icon="inline-start" aria-hidden="true" />
			<T id={canManage ? "action.edit" : "action.view"} />
		</Button>
	);
}
