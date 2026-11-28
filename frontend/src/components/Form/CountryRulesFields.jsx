import { CircleAlert, XIcon } from "lucide-react";
import { useRef } from "react";
import { useFieldArray, useFormContext, useFormState, useWatch } from "react-hook-form";
import { Link } from "react-router";
import { Button, DESTRUCTIVE_TEXT } from "src/components/Button";
import { Flag } from "src/components/Flag";
import { GeoipCredit } from "src/components/GeoipCredit";
import { Input } from "src/components/ui/input";
import { intl, T } from "src/locale";
import { geoRestrictions, switchForMode } from "src/modules/AccessListForms";
import { countryName, isKnownCountry } from "src/modules/Countries";
import { StatusAlert } from "src/pages/Settings/StatusAlert";
import { ChoiceField } from "./ChoiceGroup";
import { CountryPicker } from "./CountryPicker";
import { FieldMessage } from "./FieldMessage";
import { useListRecheck } from "./HookForm";
import { SwitchField } from "./SwitchField";
import { SwitchList } from "./SwitchList";

const MODES = ["off", "allow", "deny"];

// one chosen country: flag, name, an optional comment, the remove button
function CountryRow({ name, index, code, onRemove, disabled }) {
	const { register, getFieldState } = useFormContext();
	const base = `${name}.${index}`;
	const formState = useFormState({ name: `${base}.comment` });
	const error = getFieldState(`${base}.comment`, formState).error?.message ?? null;
	const label = countryName(code, intl.locale);
	return (
		<li className="flex items-start gap-2">
			<span className="flex h-9 w-44 shrink-0 items-center gap-2 text-sm">
				{isKnownCountry(code) ? <Flag countryCode={code} tooltip={false} /> : null}
				<span className="min-w-0 truncate" title={code}>
					{label}
				</span>
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<Input
					type="text"
					{...register(`${base}.comment`)}
					autoComplete="off"
					maxLength={255}
					aria-label={intl.formatMessage({ id: "access-list.countries.comment" })}
					placeholder={intl.formatMessage({ id: "access-list.countries.comment" })}
					aria-invalid={error ? "true" : undefined}
					aria-describedby={error ? `${name}-${index}-comment-error` : undefined}
				/>
				{error ? <FieldMessage id={`${name}-${index}-comment-error`}>{error}</FieldMessage> : null}
			</div>
			<Button
				variant="ghost"
				className={DESTRUCTIVE_TEXT}
				size="icon"
				disabled={disabled}
				aria-label={intl.formatMessage({ id: "access-list.countries.remove" }, { name: label })}
				title={intl.formatMessage({ id: "access-list.countries.remove" }, { name: label })}
				onClick={onRemove}
			>
				<XIcon aria-hidden="true" />
			</Button>
		</li>
	);
}

/**
 * The Countries tab of the access list window: the mode, the picker, the chosen countries with their comments and
 * the two switches. The form has geoMode, countries, geoBlockUnknown and geoDrop (AccessListForms.js).
 *
 * @param {Object} props
 * @param {Object} props.saved       the saved list (its npmproGeoMode), as the window's first data
 * @param {Object} props.status      GET /nginx/access-lists/geoip, camelCase
 * @param {Function} [props.onNavigate]  runs when the Settings link is followed (closes the window)
 */
export function CountryRulesFields({ saved, status, onNavigate }) {
	const { register, getValues, setValue } = useFormContext();
	const { fields, append, remove } = useFieldArray({ name: "countries" });
	const { afterRemove } = useListRecheck("countries");
	const { errors } = useFormState({ name: "countries" });
	const mode = useWatch({ name: "geoMode" });
	const { modeLocked, canAdd } = geoRestrictions(saved, status.available);
	// the switch for unknown countries follows the mode until the user has toggled it
	const touched = useRef(false);
	const lastMode = useRef(getValues("geoMode"));
	const rows = useWatch({ name: "countries" }) ?? [];
	const listError = typeof errors.countries?.message === "string" ? errors.countries.message : null;
	const hasRules = mode !== "off" || (saved?.npmproGeoMode ?? "off") !== "off";

	const onModeChange = (next) => {
		const previous = lastMode.current;
		lastMode.current = next;
		setValue("geoBlockUnknown", switchForMode(previous, next, getValues("geoBlockUnknown"), touched.current), {
			shouldDirty: true,
		});
	};
	const options = MODES.map((value) => ({
		value,
		label: <T id={`access-list.countries.mode.${value}`} />,
		disabled: modeLocked.includes(value),
	}));

	return (
		<div className="flex flex-col gap-3">
			{status.available ? null : (
				<StatusAlert variant="warning" icon={CircleAlert}>
					<T id="access-list.countries.no-database" />{" "}
					<Link to="/settings/geoip" className="underline underline-offset-4" onClick={onNavigate}>
						<T id="access-list.countries.settings-link" />
					</Link>
				</StatusAlert>
			)}
			{status.available && status.failsOpen && hasRules ? (
				<StatusAlert variant="warning" icon={CircleAlert}>
					<T id="access-list.countries.fails-open" />{" "}
					<Link to="/settings/geoip" className="underline underline-offset-4" onClick={onNavigate}>
						<T id="access-list.countries.settings-link" />
					</Link>
				</StatusAlert>
			) : null}
			<ChoiceField
				name="geoMode"
				legend={<T id="access-list.countries.mode" />}
				options={options}
				onChange={onModeChange}
				className="mb-0"
			/>
			<div className="flex flex-col gap-1.5">
				<CountryPicker
					value={fields.map(({ country }) => country)}
					disabled={!canAdd || mode === "off"}
					onAdd={(code) => {
						append({ country: code, comment: "" }, { shouldFocus: false });
						afterRemove();
					}}
				/>
				<GeoipCredit provider={status.provider} />
			</div>
			{fields.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					<T id="access-list.countries.empty" />
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{fields.map((field, index) => (
						<CountryRow
							key={field.id}
							name="countries"
							index={index}
							code={rows[index]?.country ?? field.country}
							onRemove={() => {
								remove(index);
								afterRemove();
							}}
						/>
					))}
				</ul>
			)}
			{listError ? <FieldMessage role="alert">{listError}</FieldMessage> : null}
			{mode === "off" ? null : (
				<SwitchList>
					<SwitchField
						id="geoBlockUnknown"
						label={<T id="access-list.countries.unknown" />}
						hint={<T id="access-list.countries.unknown.hint" />}
						{...register("geoBlockUnknown", {
							onChange: () => {
								touched.current = true;
							},
						})}
					/>
				</SwitchList>
			)}
			<SwitchList>
				<SwitchField
					id="geoDrop"
					label={<T id="access-list.countries.drop" />}
					hint={<T id="access-list.countries.drop.hint" />}
					{...register("geoDrop")}
				/>
			</SwitchList>
			<p className="text-muted-foreground text-sm">
				<T id="access-list.countries.note" />
			</p>
		</div>
	);
}
