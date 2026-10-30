import { IconArrowDown, IconArrowUp, IconLock, IconLockOpen2, IconWorld, IconX } from "@tabler/icons-react";
import { useController, useWatch } from "react-hook-form";
import Select, { components } from "react-select";
import { ApiErrorContent } from "src/components/ErrorAlert";
import { useAccessLists } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { selectClassNames } from "src/modules/Select";
import { NoticeAlert } from "../NoticeAlert";
import { useRecheckDependent } from "./HookForm";

const OptionContent = (label, subLabel, icon) => (
	<div className="flex-fill">
		<div className="fw-medium">
			{icon}
			<strong className="ms-1">{label}</strong>
		</div>
		<div className="text-secondary mt-1 ps-3">{subLabel}</div>
	</div>
);

const Option = (props) => (
	<components.Option {...props}>{OptionContent(props.data.label, props.data.subLabel)}</components.Option>
);

const TypeOption = (props) => (
	<components.Option {...props}>
		{OptionContent(props.data.label, props.data.subLabel, props.data.icon)}
	</components.Option>
);

/**
 * The access of a proxy host or of one of its locations: the type (public, custom lists, or for a location the
 * host's lists) and the custom lists in order. Two controllers: the type and the list ids.
 *
 * @param {Object}  props
 * @param {string}  props.name         the ids field (npmproAccessListIds, locations.0.npmproAccessListIds)
 * @param {string}  props.typeName     the type field
 * @param {string}  [props.location]   a location's path; undefined for the host itself (no "global" type)
 * @param {string}  [props.authRequest]
 */
export function AccessFields({ name, typeName, location, authRequest }) {
	const { field: idsField } = useController({ name });
	const { field: typeField } = useController({ name: typeName });
	// the host's own lists, which a location of type "global" uses
	const [hostType, hostIds] = useWatch({ name: ["npmproAccessListType", "npmproAccessListIds"] });
	// a new type changes whether the ids are required
	const recheckIds = useRecheckDependent(name);
	const values = idsField.value;
	const aclValue = typeField.value;
	const { isPending, isError, error, data } = useAccessLists(["owner", "items", "clients"]);

	const createDefaultItem = (item) => ({
		value: item.id,
		label: item.name,
		subLabel: intl.formatMessage(
			{ id: "access-list.subtitle" },
			{
				users: item?.items?.length,
				rules: item?.clients?.length,
				date: formatDateTime(item?.createdOn),
			},
		),
		meta: item,
	});

	const createOption = (type) => {
		if (type === "global") {
			return {
				icon: <IconWorld size={14} className="text-cyan" />,
				type,
				label: intl.formatMessage({ id: "access-list.global" }),
				subLabel: intl.formatMessage({ id: "access-list.global.subtitle" }),
			};
		}
		if (type === "custom") {
			return {
				icon: <IconLock size={14} className="text-lime" />,
				type,
				label: intl.formatMessage({ id: "access-list.custom" }),
				subLabel: intl.formatMessage({ id: "access-list.custom.subtitle" }),
			};
		}
		return {
			icon: <IconLockOpen2 size={14} className="text-red" />,
			type,
			label: intl.formatMessage({ id: "access-list.public" }),
			subLabel: intl.formatMessage({ id: "access-list.public.subtitle" }),
		};
	};

	const defaultOptions = data?.map(createDefaultItem) || [];
	const valuesSet = new Set(values);
	const options = defaultOptions.filter((option) => !valuesSet.has(option.value));

	const typeOptions = () => {
		const ret = [];
		if (!isPending && !isError && location !== undefined) {
			ret.push(createOption("global"));
		}
		ret.push(createOption("public"));
		if (!isPending && !isError && defaultOptions.length > 0) {
			ret.push(createOption("custom"));
		}
		return ret;
	};

	const applyUpdatedValues = (newValues) => idsField.onChange(newValues);

	const onAccessListChange = (acl, idx) => {
		const newValues = values.map((id, i) => (i === idx ? acl.id : id));
		applyUpdatedValues(newValues);
	};

	const handleAdd = () => {
		const newAccessOption = options[0];
		const newValues = [...values, newAccessOption.meta.id];
		applyUpdatedValues(newValues);
	};

	const handleMoveUp = (idx) => {
		if (idx > 0) {
			const newIdx = idx - 1;
			const newValues = [...values];
			const aclId = newValues[idx];
			newValues[idx] = newValues[newIdx];
			newValues[newIdx] = aclId;
			applyUpdatedValues(newValues);
		}
	};

	const handleMoveDown = (idx) => {
		if (idx < values.length - 1) {
			const newIdx = idx + 1;
			const newValues = [...values];
			const aclId = newValues[idx];
			newValues[idx] = newValues[newIdx];
			newValues[newIdx] = aclId;
			applyUpdatedValues(newValues);
		}
	};

	const handleRemove = (aclId) => {
		const newValues = values.filter((id) => id !== aclId);
		applyUpdatedValues(newValues);
	};

	const acls = (
		{
			custom: values,
			global: hostType === "custom" ? hostIds : [],
		}[aclValue] ?? []
	)
		.map((id) => data?.find((acl) => acl.id === id))
		.filter(Boolean);

	return (
		<div className="mb-3">
			{isPending ? <div className="placeholder placeholder-lg col-12 my-3 placeholder-glow" /> : null}
			{isError ? (
				<div className="invalid-feedback d-block">
					<ApiErrorContent error={error} />
				</div>
			) : null}
			<div className="row">
				<div className="col-md-10">
					<div className="input-group mb-3 shadow-none">
						<Select
							className="col-md-8"
							unstyled
							classNames={selectClassNames}
							isSearchable={false}
							getOptionValue={(o) => o.type}
							value={createOption(aclValue)}
							options={typeOptions()}
							components={{ Option: TypeOption }}
							styles={{
								option: (base) => ({
									...base,
									height: "100%",
								}),
							}}
							ref={typeField.ref}
							onChange={(e) => {
								typeField.onChange(e.type);
								recheckIds();
							}}
							onBlur={typeField.onBlur}
						/>
					</div>
				</div>
			</div>
			{!isPending && !isError && aclValue === "custom" ? (
				<>
					{values.map((item, idx) => (
						<div key={item} className="input-group mb-1 shadow-none">
							<Select
								className="col-md-8 mb-1"
								unstyled
								classNames={selectClassNames}
								value={
									defaultOptions.find((o) => o.value === item) ?? { value: item, label: `#${item}` }
								}
								options={options}
								components={{ Option }}
								styles={{
									option: (base) => ({
										...base,
										height: "100%",
									}),
								}}
								onChange={(e) => {
									onAccessListChange(e.meta, idx);
								}}
							/>

							{idx > 0 ? (
								<button
									type="button"
									aria-label={intl.formatMessage({ id: "aria.move-up" })}
									className="btn mb-1 ms-1"
									onClick={() => {
										handleMoveUp(idx);
									}}
								>
									<IconArrowUp size={16} />
								</button>
							) : null}
							{idx < values.length - 1 ? (
								<button
									type="button"
									aria-label={intl.formatMessage({ id: "aria.move-down" })}
									className="btn mb-1 ms-1"
									onClick={() => {
										handleMoveDown(idx);
									}}
								>
									<IconArrowDown size={16} />
								</button>
							) : null}
							<button
								type="button"
								aria-label={intl.formatMessage({ id: "aria.remove" })}
								className="btn btn-ghost btn-danger p-0 mb-1"
								onClick={() => {
									handleRemove(item);
								}}
							>
								<IconX size={16} />
							</button>
						</div>
					))}
					{values.length === 0 ? (
						<>
							<input
								ref={idsField.ref}
								name={name}
								className="visually-hidden"
								tabIndex={-1}
								required
								defaultValue=""
							/>
							<div className="invalid-feedback d-block">
								<T id="error.required" />
							</div>
						</>
					) : null}
					{options.length > 0 && ( // only show add button if there are more acls that can be added
						<div className="text-center">
							<button type="button" className="btn my-3" onClick={handleAdd}>
								<T id="action.add" />
							</button>
						</div>
					)}
				</>
			) : null}
			{authRequest !== "none" &&
				acls[0]?.satisfyAny &&
				acls.some(
					(acl) =>
						acl.items?.length > 0 || acl.clients?.some((client) => client.address?.toLowerCase() !== "all"),
				) && (
					<NoticeAlert>
						<T id="access-list.satisfy-any-warning" data={{ name: acls[0].name }} />
					</NoticeAlert>
				)}
		</div>
	);
}
