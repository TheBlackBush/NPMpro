import cn from "clsx";
import { T } from "src/locale";

const getClasses = (active) =>
	cn("btn", {
		active,
		"bg-orange-lt": active,
		"border-orange": active,
	});

// The field name may be nested (for example "autoCreatePermissions.proxyHosts"); the rules look at its siblings.
const splitName = (name) => {
	const dot = name.lastIndexOf(".");
	return { prefix: name.slice(0, dot + 1), key: name.slice(dot + 1) };
};

// given the field and clicked permission, intelligently set the value, and
// other values that depends on it.
const handleChange = (form, field, perm) => {
	const { prefix, key } = splitName(field.name);
	const sibling = (name) => form.getFieldProps(`${prefix}${name}`).value;
	if (key === "proxyHosts" && perm !== "hidden" && sibling("accessLists") === "hidden") {
		form.setFieldValue(`${prefix}accessLists`, "view");
	}
	// certs are required for proxy and redirection hosts, and streams
	if (
		["proxyHosts", "redirectionHosts", "deadHosts", "streams"].includes(key) &&
		perm !== "hidden" &&
		sibling("certificates") === "hidden"
	) {
		form.setFieldValue(`${prefix}certificates`, "view");
	}

	form.setFieldValue(field.name, perm);
};

function PermissionButtons({ field, form }) {
	const { prefix, key } = splitName(field.name);
	const sibling = (name) => form.getFieldProps(`${prefix}${name}`).value;
	const isManage = field.value === "manage";
	const isView = field.value === "view";
	const isHidden = field.value === "hidden";

	let hiddenDisabled = false;
	if (key === "accessLists") {
		hiddenDisabled = sibling("proxyHosts") !== "hidden";
	}
	if (key === "certificates") {
		hiddenDisabled =
			sibling("proxyHosts") !== "hidden" ||
			sibling("redirectionHosts") !== "hidden" ||
			sibling("deadHosts") !== "hidden" ||
			sibling("streams") !== "hidden";
	}

	return (
		<div>
			<fieldset className="btn-group w-100">
				<input
					type="radio"
					className="btn-check"
					name={field.name}
					id={`${field.name}-manage`}
					autoComplete="off"
					value="manage"
					checked={field.value === "manage"}
					onChange={() => handleChange(form, field, "manage")}
				/>

				<label htmlFor={`${field.name}-manage`} className={getClasses(isManage)}>
					<T id="permissions.manage" />
				</label>
				<input
					type="radio"
					className="btn-check"
					name={field.name}
					id={`${field.name}-view`}
					autoComplete="off"
					value="view"
					checked={field.value === "view"}
					onChange={() => handleChange(form, field, "view")}
				/>

				<label htmlFor={`${field.name}-view`} className={getClasses(isView)}>
					<T id="permissions.view" />
				</label>
				<input
					type="radio"
					className="btn-check"
					name={field.name}
					id={`${field.name}-hidden`}
					autoComplete="off"
					value="hidden"
					checked={field.value === "hidden"}
					disabled={hiddenDisabled}
					onChange={() => handleChange(form, field, "hidden")}
				/>

				<label htmlFor={`${field.name}-hidden`} className={getClasses(isHidden)}>
					<T id="permissions.hidden" />
				</label>
			</fieldset>
		</div>
	);
}

function VisibilityButtons({ field, form }) {
	return (
		<fieldset className="btn-group w-100">
			<input
				type="radio"
				className="btn-check"
				name={field.name}
				id={`${field.name}-user`}
				autoComplete="off"
				value="user"
				checked={field.value === "user"}
				onChange={() => form.setFieldValue(field.name, "user")}
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
				onChange={() => form.setFieldValue(field.name, "all")}
			/>

			<label htmlFor={`${field.name}-all`} className={getClasses(field.value === "all")}>
				<T id="permissions.visibility.all" />
			</label>
		</fieldset>
	);
}

export { PermissionButtons, VisibilityButtons };
