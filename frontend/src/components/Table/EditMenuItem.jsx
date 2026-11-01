import { IconEdit, IconEye } from "@tabler/icons-react";
import { useCanManage } from "src/hooks";
import { T } from "src/locale";

/**
 * The first entry of a host or access list row menu: Edit, or View for a user who may only view the section (the
 * window then opens as a View window, UX-17)
 *
 * @param {Object}   props
 * @param {string}   props.section  Permissions.js PROXY_HOSTS, ...
 * @param {Function} props.onClick
 */
export function EditMenuItem({ section, onClick }) {
	const canManage = useCanManage(section);
	const Icon = canManage ? IconEdit : IconEye;
	return (
		<button type="button" className="dropdown-item" onClick={onClick}>
			<Icon className="icon dropdown-item-icon" aria-hidden="true" />
			<T id={canManage ? "action.edit" : "action.view"} />
		</button>
	);
}
