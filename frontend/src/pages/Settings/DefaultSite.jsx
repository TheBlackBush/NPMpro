import { useState } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { ApiErrorContent, ErrorAlert, HookForm, Loading, useAppForm, useResetToSaved } from "src/components";
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

const validate = defaultSiteValidate(validations);

function Heading() {
	return (
		<h2 className="mb-3">
			<T id="settings.default-site" />
		</h2>
	);
}

// the choices; another choice hides the fields of the last one, and their messages go with them
function OptionField() {
	const { register, clearErrors } = useFormContext();
	const option = register("value", {
		onChange: (event) => clearErrors(defaultSiteHiddenFields(event.target.value)),
	});
	return (
		<div className="mb-3">
			<div className="form-label">
				<T id="settings.default-site.description" />
			</div>
			<div className="form-selectgroup-boxes row">
				{DEFAULT_SITE_OPTIONS.map((value) => (
					<div className="col-12" key={value}>
						<label className="form-selectgroup-item mb-2">
							<input {...option} type="radio" value={value} className="form-selectgroup-input" />
							<span className="form-selectgroup-label d-flex align-items-center p-3">
								<span className="me-3">
									<span className="form-selectgroup-check" />
								</span>
								<span className="form-selectgroup-label-content">
									<span className="form-selectgroup-title strong mb-1">
										<T id={`settings.default-site.${value}`} />
									</span>
									<span className="d-block text-secondary">
										<T id={`settings.default-site.${value}.description`} />
									</span>
								</span>
							</span>
						</label>
					</div>
				))}
			</div>
		</div>
	);
}

function RedirectField() {
	const { register } = useFormContext();
	const { errors } = useFormState({ name: "redirect", exact: true });
	const error = errors.redirect?.message;
	return (
		<div className="mt-5 mb-3">
			<label className="form-label" htmlFor="redirect">
				<T id="settings.default-site.redirect" />
			</label>
			<div>
				<input
					{...register("redirect")}
					id="redirect"
					type="text"
					placeholder="https://"
					autoComplete="off"
					className={`form-control ${error ? "is-invalid" : ""}`}
				/>
				{error ? <div className="invalid-feedback">{error}</div> : null}
			</div>
		</div>
	);
}

function HtmlFields() {
	const { register } = useFormContext();
	const { errors } = useFormState({ name: ["html", "status"] });
	return (
		<>
			<div className="mt-5 mb-3">
				<label className="form-label" htmlFor="html">
					<T id="settings.default-site.html" />
				</label>
				<div>
					<textarea
						{...register("html")}
						id="html"
						className={`form-control font-monospace ${errors.html ? "is-invalid" : ""}`}
						spellCheck={false}
						placeholder={intl.formatMessage({ id: "settings.default-site.html.placeholder" })}
						rows={14}
					/>
					{errors.html ? <div className="invalid-feedback">{errors.html.message}</div> : null}
				</div>
			</div>
			<div className="mb-3">
				<label className="form-label" htmlFor="status">
					<T id="settings.default-site.status" />
				</label>
				<input
					{...register("status")}
					id="status"
					type="number"
					min={400}
					max={599}
					placeholder="200"
					autoComplete="off"
					className={`form-control ${errors.status ? "is-invalid" : ""}`}
				/>
				{errors.status ? <div className="invalid-feedback">{errors.status.message}</div> : null}
			</div>
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
