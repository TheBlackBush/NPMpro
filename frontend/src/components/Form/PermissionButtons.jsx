import { useMemo } from "react";
import { useController, useFormContext, useWatch } from "react-hook-form";
import { T } from "src/locale";
import { applyChanges } from "src/modules/HookForm";
import { hiddenRuledOut, PERMISSION_SECTIONS, permissionChanges } from "src/modules/Permissions";
import { ChoiceGroup } from "./ChoiceGroup";

// The field name may be nested (for example "autoCreatePermissions.proxyHosts"); the rules look at its siblings.
const splitName = (name) => {
	const dot = name.lastIndexOf(".");
	return { prefix: name.slice(0, Math.max(dot, 0)), key: name.slice(dot + 1) };
};

const PERMS = [
	["manage", "permissions.manage"],
	["view", "permissions.view"],
	["hidden", "permissions.hidden"],
];

/**
 * The permission sections in the order the windows show them, with the translation of their name (the legend)
 */
const PERMISSION_ROWS = [
	["proxyHosts", "proxy-hosts"],
	["redirectionHosts", "redirection-hosts"],
	["deadHosts", "dead-hosts"],
	["streams", "streams"],
	["accessLists", "access-lists"],
	["certificates", "certificates"],
];

/**
 * Manage, View or Hidden for one section of a user's permissions (a field of the form around it, e.g.
 * "proxyHosts" or "autoCreatePermissions.proxyHosts"), as a choice group named by legend. A choice also turns on
 * what the section needs (the access lists for proxy hosts, the certificates for hosts and streams), and Hidden is
 * ruled out while another section needs this one.
 *
 * @param {Object} props
 * @param {string} props.name
 * @param {*}      props.legend
 */
function PermissionButtons({ name, legend }) {
	const { prefix, key } = splitName(name);
	const { setValue } = useFormContext();
	const { field } = useController({ name });
	// the same array while the prefix stays, so useWatch does not subscribe again on every render
	const siblingNames = useMemo(
		() => PERMISSION_SECTIONS.map((section) => (prefix ? `${prefix}.${section}` : section)),
		[prefix],
	);
	const siblingValues = useWatch({ name: siblingNames });
	const siblings = Object.fromEntries(PERMISSION_SECTIONS.map((section, index) => [section, siblingValues[index]]));
	const choose = (perm) => {
		applyChanges(setValue, permissionChanges(siblings, key, perm), prefix);
		field.onChange(perm);
	};
	return (
		<ChoiceGroup
			name={field.name}
			legend={legend}
			fill
			value={field.value}
			inputRef={field.ref}
			onBlur={field.onBlur}
			onChange={choose}
			options={PERMS.map(([perm, labelId]) => ({
				value: perm,
				label: <T id={labelId} />,
				disabled: perm === "hidden" && hiddenRuledOut(siblings, key),
			}))}
		/>
	);
}

const VISIBILITY_OPTIONS = [
	{ value: "user", label: <T id="permissions.visibility.user" /> },
	{ value: "all", label: <T id="permissions.visibility.all" /> },
];

/**
 * Who a user sees items of: the user's own or all (a field of the form around it), as a choice group
 *
 * @param {Object} props
 * @param {string} props.name
 */
function VisibilityButtons({ name }) {
	const { field } = useController({ name });
	return (
		<ChoiceGroup
			name={field.name}
			legend={<T id="permissions.visibility.title" />}
			fill
			value={field.value}
			inputRef={field.ref}
			onBlur={field.onBlur}
			onChange={field.onChange}
			options={VISIBILITY_OPTIONS}
		/>
	);
}

export { PERMISSION_ROWS, PermissionButtons, VisibilityButtons };
