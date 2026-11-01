import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	ChoiceField,
	ErrorAlert,
	HookForm,
	Loading,
	TextField,
	useAppForm,
	useResetToSaved,
} from "src/components";
import { useSetSetting, useSetting } from "src/hooks";
import { intl, T } from "src/locale";
import {
	DEFAULT_SITE_OPTIONS,
	defaultSiteHiddenFields,
	defaultSitePayload,
	defaultSiteValidate,
	defaultSiteValues,
} from "src/modules/SettingsForms";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { SaveBar } from "./SaveBar";
import { SettingsHeading } from "./SettingsHeading";

const validate = defaultSiteValidate(validations);

function Heading() {
	return <SettingsHeading titleId="settings.default-site" />;
}

const OPTIONS = DEFAULT_SITE_OPTIONS.map((value) => ({
	value,
	label: <T id={`settings.default-site.${value}`} />,
	description: <T id={`settings.default-site.${value}.description`} />,
}));

// the choices as the form layer's described boxes; another choice hides the fields of the last one, and their
// messages go with them
function OptionField() {
	const { clearErrors } = useFormContext();
	return (
		<ChoiceField
			name="value"
			legend={<T id="settings.default-site.description" />}
			variant="boxes"
			vertical
			options={OPTIONS}
			onChange={(value) => clearErrors(defaultSiteHiddenFields(value))}
		/>
	);
}

function RedirectField() {
	return (
		<TextField
			name="redirect"
			label={<T id="settings.default-site.redirect" />}
			type="text"
			placeholder="https://"
			autoComplete="off"
		/>
	);
}

function HtmlFields() {
	return (
		<>
			<TextField
				name="html"
				label={<T id="settings.default-site.html" />}
				as="textarea"
				controlClassName="font-monospace"
				spellCheck={false}
				placeholder={intl.formatMessage({ id: "settings.default-site.html.placeholder" })}
				rows={14}
			/>
			<TextField
				name="status"
				label={<T id="settings.default-site.status" />}
				type="number"
				min={400}
				max={599}
				placeholder="200"
				autoComplete="off"
			/>
		</>
	);
}

/**
 * The form of the loaded setting: its starting values are taken once (a refetch does not change the form); after a
 * save the saved values are the new starting point
 */
function DefaultSiteForm({ data }) {
	const { mutateAsync: setSetting } = useSetSetting();
	const [errorMsg, setErrorMsg] = useState(null);
	const [defaultValues] = useState(() => defaultSiteValues(data));
	const methods = useAppForm({ defaultValues, validate });
	const resetToSaved = useResetToSaved(methods);
	const option = useWatch({ control: methods.control, name: "value" });

	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			await setSetting(defaultSitePayload(values, data));
			// the saved values are the new starting point (no unsaved changes)
			resetToSaved();
			showObjectSuccess("setting", "saved");
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<HookForm methods={methods} onSubmit={onSubmit} className="d-flex flex-column flex-fill">
			<div className="card-body flex-fill">
				<Heading />
				<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
				<OptionField />
				{option === "redirect" && <RedirectField />}
				{option === "html" && <HtmlFields />}
			</div>
			<SaveBar />
		</HookForm>
	);
}

export default function DefaultSite() {
	const { data, isPending, error } = useSetting("default-site");

	if (error) {
		return (
			<div className="card-body">
				<Heading />
				<div className="mb-3">
					<ErrorAlert error={error} />
				</div>
			</div>
		);
	}

	if (isPending) {
		return (
			<div className="card-body">
				<Heading />
				<div className="mb-3">
					<Loading noLogo />
				</div>
			</div>
		);
	}

	return <DefaultSiteForm data={data} />;
}
