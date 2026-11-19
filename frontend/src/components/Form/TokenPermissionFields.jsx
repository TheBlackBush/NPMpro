import { useId } from "react";
import { useController, useFormContext, useWatch } from "react-hook-form";
import { PERMISSION_ROWS } from "src/components/Form/PermissionButtons";
import { Button } from "src/components/ui/button";
import { intl, T } from "src/locale";
import { clampChanges, levelAllowed, setAllLevels } from "src/modules/ApiTokens";
import { applyChanges } from "src/modules/HookForm";
import { hiddenRuledOut, PERMISSION_SECTIONS, permissionChanges } from "src/modules/Permissions";
import { SegmentedChoice } from "./SegmentedChoice";

const LEVEL_OPTIONS = [
	["manage", "permissions.manage"],
	["view", "permissions.view"],
	["hidden", "permissions.hidden"],
];

function SectionRow({ section, labelId, caps, values }) {
	const id = useId();
	const { setValue } = useFormContext();
	const { field } = useController({ name: section });
	const choose = (level) => {
		applyChanges(setValue, clampChanges(permissionChanges(values, section, level), caps));
		field.onChange(level);
	};
	return (
		<>
			<span id={id} className="text-sm">
				<T id={labelId} />
			</span>
			<SegmentedChoice
				name={field.name}
				labelledBy={id}
				value={field.value}
				inputRef={field.ref}
				onBlur={field.onBlur}
				onChange={choose}
				options={LEVEL_OPTIONS.map(([level, textId]) => ({
					value: level,
					label: <T id={textId} />,
					disabled:
						(level === "hidden" && hiddenRuledOut(values, section)) || !levelAllowed(level, caps[section]),
				}))}
			/>
		</>
	);
}

/**
 * Item Visibility and the six section levels of a new token as segmented controls, with "Set all" links. A level
 * above the owner's (caps) is disabled and no automatic change goes above it; All Items only for an owner who sees all.
 */
function TokenPermissionFields({ caps }) {
	const visibilityId = useId();
	const permissionsId = useId();
	const { setValue } = useFormContext();
	const { field: visibility } = useController({ name: "visibility" });
	const current = useWatch({ name: PERMISSION_SECTIONS });
	const values = Object.fromEntries(PERMISSION_SECTIONS.map((section, index) => [section, current[index]]));
	return (
		<div className="@container mb-4 flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<span id={visibilityId} className="font-medium text-sm">
					<T id="permissions.visibility.title" />
				</span>
				<SegmentedChoice
					name={visibility.name}
					labelledBy={visibilityId}
					value={visibility.value}
					inputRef={visibility.ref}
					onBlur={visibility.onBlur}
					onChange={visibility.onChange}
					options={[
						{ value: "user", label: <T id="permissions.visibility.user" /> },
						{
							value: "all",
							label: <T id="permissions.visibility.all" />,
							disabled: caps.visibility !== "all",
						},
					]}
				/>
			</div>
			<fieldset aria-labelledby={permissionsId} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
				<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
					<span id={permissionsId} className="font-medium text-sm">
						<T id="api-tokens.permissions" />
					</span>
					<span className="flex flex-wrap items-baseline gap-x-2 text-muted-foreground text-xs">
						<T id="api-tokens.set-all" />
						{LEVEL_OPTIONS.map(([level, textId]) => (
							<Button
								key={level}
								type="button"
								variant="link"
								size="xs"
								className="h-auto p-0"
								aria-label={intl.formatMessage(
									{ id: "api-tokens.set-all-to" },
									{ level: intl.formatMessage({ id: textId }) },
								)}
								onClick={() => applyChanges(setValue, setAllLevels(level, caps))}
							>
								<T id={textId} />
							</Button>
						))}
					</span>
				</div>
				<div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 @md:grid-cols-[9.5rem_minmax(0,1fr)]">
					{PERMISSION_ROWS.map(([section, labelId]) => (
						<SectionRow key={section} section={section} labelId={labelId} caps={caps} values={values} />
					))}
				</div>
			</fieldset>
		</div>
	);
}

export { TokenPermissionFields };
