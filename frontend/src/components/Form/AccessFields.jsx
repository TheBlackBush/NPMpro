import { ArrowDownIcon, ArrowUpIcon, GlobeIcon, LockIcon, LockOpenIcon, PlusIcon, XIcon } from "lucide-react";
import { useCallback, useRef } from "react";
import { useController, useWatch } from "react-hook-form";
import { Button, DESTRUCTIVE_TEXT } from "src/components/Button";
import { Combobox } from "src/components/Combobox";
import { ApiErrorContent } from "src/components/ErrorAlert";
import { Skeleton } from "src/components/ui/skeleton";
import { useAccessLists } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { rowKeysOf } from "src/modules/HookForm";
import { NoticeAlert } from "../NoticeAlert";
import { FieldMessage } from "./FieldMessage";
import { useReadOnly, useRecheckDependent } from "./HookForm";

// a row of the list: the icon (the type options have one), the name and the details under it
const renderOption = (option) => (
	<div className="flex-1">
		<div className="font-medium">
			{option.icon}
			<strong className="ms-1">{option.label}</strong>
		</div>
		<div className="mt-1 ps-3 text-muted-foreground">{option.subLabel}</div>
	</div>
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
	const { ref: idsRef } = idsField;
	const { ref: typeRef } = typeField;
	// the type select is the visible control of both fields: a refused save with custom and no lists focuses it
	// (the hidden required input below only marks the field)
	const selectRef = useCallback(
		(select) => {
			typeRef(select);
			idsRef(select);
		},
		[typeRef, idsRef],
	);
	// the host's own lists, which a location of type "global" uses
	const [hostType, hostIds] = useWatch({ name: ["npmproAccessListType", "npmproAccessListIds"] });
	// a new type changes whether the ids are required
	const recheckIds = useRecheckDependent(name);
	// a View window: the selects are disabled too (a disabled fieldset does not reach the comboboxes)
	const readOnly = useReadOnly();
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
				icon: <GlobeIcon aria-hidden="true" className="size-3.5 text-primary" />,
				value: type,
				label: intl.formatMessage({ id: "access-list.global" }),
				subLabel: intl.formatMessage({ id: "access-list.global.subtitle" }),
			};
		}
		if (type === "custom") {
			return {
				icon: <LockIcon aria-hidden="true" className="size-3.5 text-success" />,
				value: type,
				label: intl.formatMessage({ id: "access-list.custom" }),
				subLabel: intl.formatMessage({ id: "access-list.custom.subtitle" }),
			};
		}
		return {
			icon: <LockOpenIcon aria-hidden="true" className="size-3.5 text-destructive" />,
			value: type,
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

	// the current type shows even when the list does not offer it (a type that needs lists not loaded yet)
	const shownTypes = typeOptions();
	const typeSelectOptions = shownTypes.some((o) => o.value === aclValue)
		? shownTypes
		: [...shownTypes, createOption(aclValue)];
	// a row offers the lists not used yet and its own; a list that is gone shows as "#id"
	const rowOptions = (item) => {
		const current = defaultOptions.find((o) => o.value === item) ?? {
			value: item,
			label: `#${item}`,
			meta: { id: item },
		};
		return [current, ...options.filter((o) => o.value !== item)];
	};

	const applyUpdatedValues = (newValues) => idsField.onChange(newValues);

	// row keys that stay with their row: a pick in a row keeps the row (and its focus), a move takes the key along
	const keyCount = useRef(0);
	const rows = useRef([]);
	rows.current = rowKeysOf(rows.current, values, () => `acl-row-${keyCount.current++}`);

	const onAccessListChange = (acl, idx) => {
		rows.current = rows.current.map((row, i) => (i === idx ? { ...row, value: acl.id } : row));
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
		<div className="flex flex-col gap-3">
			{isPending ? <Skeleton className="h-8 w-full" /> : null}
			{isError ? (
				<FieldMessage>
					<ApiErrorContent error={error} />
				</FieldMessage>
			) : null}
			<Combobox
				aria-label={intl.formatMessage({ id: "access-list" })}
				searchable={false}
				disabled={readOnly}
				value={aclValue}
				options={typeSelectOptions}
				renderOption={renderOption}
				ref={selectRef}
				onChange={(type) => {
					typeField.onChange(type);
					recheckIds();
				}}
				onBlur={typeField.onBlur}
			/>
			{!isPending && !isError && aclValue === "custom" ? (
				<>
					{values.map((item, idx) => (
						<div key={rows.current[idx].key} className="flex items-center gap-1">
							<Combobox
								className="min-w-0 flex-1"
								aria-label={intl.formatMessage({ id: "access-list" })}
								value={item}
								options={rowOptions(item)}
								renderOption={renderOption}
								disabled={readOnly}
								onChange={(_value, option) => {
									onAccessListChange(option.meta, idx);
								}}
							/>
							{idx > 0 ? (
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={intl.formatMessage({ id: "aria.move-up" })}
									onClick={() => {
										handleMoveUp(idx);
									}}
								>
									<ArrowUpIcon aria-hidden="true" />
								</Button>
							) : null}
							{idx < values.length - 1 ? (
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={intl.formatMessage({ id: "aria.move-down" })}
									onClick={() => {
										handleMoveDown(idx);
									}}
								>
									<ArrowDownIcon aria-hidden="true" />
								</Button>
							) : null}
							<Button
								variant="ghost"
								className={DESTRUCTIVE_TEXT}
								size="icon-sm"
								aria-label={intl.formatMessage({ id: "aria.remove" })}
								onClick={() => {
									handleRemove(item);
								}}
							>
								<XIcon aria-hidden="true" />
							</Button>
						</div>
					))}
					{values.length === 0 ? (
						<>
							<input name={name} className="sr-only" tabIndex={-1} required defaultValue="" />
							<FieldMessage>
								<T id="error.required" />
							</FieldMessage>
						</>
					) : null}
					{!readOnly &&
						options.length > 0 && ( // only show add button if there are more acls that can be added
							<Button className="self-start" onClick={handleAdd}>
								<PlusIcon data-icon="inline-start" aria-hidden="true" />
								<T id="action.add" />
							</Button>
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
