import cn from "clsx";
import { Fragment } from "react";
import { useController, useFormContext, useWatch } from "react-hook-form";
import { T } from "src/locale";
import { applyChanges } from "src/modules/HookForm";
import { hiddenRuledOut, PERMISSION_SECTIONS, permissionChanges } from "src/modules/Permissions";

const getClasses = (active) =>
	cn("btn", {
		active,
		"bg-orange-lt": active,
		"border-orange": active,
	});

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
 * Manage, View or Hidden for one section of a user's permissions (a field of the form around it, e.g.
 * "proxyHosts" or "autoCreatePermissions.proxyHosts"). A choice also turns on what the section needs (the access
 * lists for proxy hosts, the certificates for hosts and streams), and Hidden is ruled out while another section needs
 * this one.
 *
 * @param {Object} props
 * @param {string} props.name
 */
function PermissionButtons({ name }) {
	const { prefix, key } = splitName(name);
	const { setValue } = useFormContext();
	const { field } = useController({ name });
	const siblingNames = PERMISSION_SECTIONS.map((section) => (prefix ? `${prefix}.${section}` : section));
	const siblingValues = useWatch({ name: siblingNames });
	const siblings = Object.fromEntries(PERMISSION_SECTIONS.map((section, index) => [section, siblingValues[index]]));
	const choose = (perm) => {
		applyChanges(setValue, permissionChanges(siblings, key, perm), prefix);
		field.onChange(perm);
	};
	return (
		<div>
			<fieldset className="btn-group w-100">
				{PERMS.map(([perm, labelId], index) => (
					<Fragment key={perm}>
						<input
							ref={index === 0 ? field.ref : undefined}
							type="radio"
							className="btn-check"
							name={field.name}
							id={`${field.name}-${perm}`}
							autoComplete="off"
							value={perm}
							checked={field.value === perm}
							disabled={perm === "hidden" && hiddenRuledOut(siblings, key)}
							onBlur={field.onBlur}
							onChange={() => choose(perm)}
						/>
						<label htmlFor={`${field.name}-${perm}`} className={getClasses(field.value === perm)}>
							<T id={labelId} />
						</label>
					</Fragment>
				))}
			</fieldset>
		</div>
	);
}

/**
 * Who a user sees items of: the user's own or all (a field of the form around it)
 *
 * @param {Object} props
 * @param {string} props.name
 */
function VisibilityButtons({ name }) {
	const { field } = useController({ name });
	return (
		<fieldset className="btn-group w-100">
			<input
				ref={field.ref}
				type="radio"
				className="btn-check"
				name={field.name}
				id={`${field.name}-user`}
				autoComplete="off"
				value="user"
				checked={field.value === "user"}
				onBlur={field.onBlur}
				onChange={() => field.onChange("user")}
			/>

			<label htmlFor={`${field.name}-user`} className={getClasses(field.value === "user")}>
				<T id="permissions.visibility.user" />
			</label>
			<input
				type="radio"
				className="btn-check"
				name={field.name}
				id={`${field.name}-all`}
				autoComplete="off"
				value="all"
				checked={field.value === "all"}
				onBlur={field.onBlur}
				onChange={() => field.onChange("all")}
			/>

			<label htmlFor={`${field.name}-all`} className={getClasses(field.value === "all")}>
				<T id="permissions.visibility.all" />
			</label>
		</fieldset>
	);
}

export { PermissionButtons, VisibilityButtons };
