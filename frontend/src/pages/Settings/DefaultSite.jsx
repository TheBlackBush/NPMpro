import { Field, Form, Formik } from "formik";
import { useState } from "react";
import { ApiErrorContent, ErrorAlert, Loading } from "src/components";
import { useSetSetting, useSetting } from "src/hooks";
import { intl, T } from "src/locale";
import { showObjectSuccess } from "src/notifications";
import { SaveBar } from "./SaveBar";

const OPTIONS = ["congratulations", "404", "444", "redirect", "html"];
// the backend's rule (lib/default-site.js): rendered into `return 302 <redirect>;`
const REDIRECT_PATTERN = /^https?:\/\/[^\s;{}"'\\#]+$/u;

// only the fields of the chosen option are checked (and sent), the others keep their saved values
const validate = (values) => {
	const errors = {};
	if (values.value === "redirect") {
		const redirect = values.redirect.trim();
		if (redirect === "") errors.redirect = intl.formatMessage({ id: "error.required" });
		else if (redirect.length > 255) {
			errors.redirect = intl.formatMessage({ id: "error.max-character-length" }, { max: 255 });
		} else if (!REDIRECT_PATTERN.test(redirect)) {
			errors.redirect = intl.formatMessage({ id: "settings.default-site.redirect.invalid" });
		}
	}
	if (values.value === "html") {
		if (values.html.trim() === "") errors.html = intl.formatMessage({ id: "error.required" });
		const status = Number(values.status);
		if (values.status !== "" && !(Number.isInteger(status) && status >= 400 && status <= 599)) {
			errors.status = intl.formatMessage({ id: "settings.default-site.status.invalid" });
		}
	}
	return errors;
};

export default function DefaultSite() {
	const { data, isPending, error } = useSetting("default-site");
	const { mutate: setSetting } = useSetSetting();
	const [errorMsg, setErrorMsg] = useState(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const onSubmit = (values, { resetForm, setSubmitting }) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		const payload = {
			id: "default-site",
			value: values.value,
			meta:
				values.value === "redirect"
					? { ...data?.meta, redirect: values.redirect.trim() }
					: values.value === "html"
						? {
								...data?.meta,
								html: values.html,
								status: values.status === "" ? undefined : Number(values.status),
							}
						: { ...data?.meta },
		};

		setSetting(payload, {
			onError: (err) => setErrorMsg(<ApiErrorContent error={err} />),
			onSuccess: () => {
				// the saved values are the new starting point (no unsaved changes)
				resetForm({ values });
				showObjectSuccess("setting", "saved");
			},
			onSettled: () => {
				setIsSubmitting(false);
				setSubmitting(false);
			},
		});
	};

	if (error) {
		return (
			<div className="card-body">
				<h2 className="mb-3">
					<T id="settings.default-site" />
				</h2>
				<div className="mb-3">
					<ErrorAlert error={error} />
				</div>
			</div>
		);
	}

	if (isPending) {
		return (
			<div className="card-body">
				<h2 className="mb-3">
					<T id="settings.default-site" />
				</h2>
				<div className="mb-3">
					<Loading noLogo />
				</div>
			</div>
		);
	}

	return (
		<Formik
			initialValues={{
				value: data?.value,
				redirect: data?.meta?.redirect || "",
				html: data?.meta?.html || "",
				status: data?.meta?.status || "",
			}}
			validate={validate}
			onSubmit={onSubmit}
		>
			{({ values }) => (
				<Form className="d-flex flex-column flex-fill" noValidate>
					<div className="card-body flex-fill">
						<h2 className="mb-3">
							<T id="settings.default-site" />
						</h2>
						<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
						<Field name="value">
							{({ field, form }) => (
								<div className="mb-3">
									<div className="form-label">
										<T id="settings.default-site.description" />
									</div>
									<div className="form-selectgroup-boxes row">
										{OPTIONS.map((option) => (
											<div className="col-12" key={option}>
												<label className="form-selectgroup-item mb-2">
													<input
														type="radio"
														name={field.name}
														value={option}
														className="form-selectgroup-input"
														checked={field.value === option}
														onChange={(e) => form.setFieldValue(field.name, e.target.value)}
													/>
													<span className="form-selectgroup-label d-flex align-items-center p-3">
														<span className="me-3">
															<span className="form-selectgroup-check" />
														</span>
														<span className="form-selectgroup-label-content">
															<span className="form-selectgroup-title strong mb-1">
																<T id={`settings.default-site.${option}`} />
															</span>
															<span className="d-block text-secondary">
																<T id={`settings.default-site.${option}.description`} />
															</span>
														</span>
													</span>
												</label>
											</div>
										))}
									</div>
								</div>
							)}
						</Field>
						{values.value === "redirect" && (
							<Field name="redirect">
								{({ field, form }) => (
									<div className="mt-5 mb-3">
										<label className="form-label" htmlFor="redirect">
											<T id="settings.default-site.redirect" />
										</label>
										<div>
											<input
												id="redirect"
												type="text"
												placeholder="https://"
												autoComplete="off"
												className={`form-control ${form.errors.redirect ? "is-invalid" : ""}`}
												{...field}
											/>
											{form.errors.redirect ? (
												<div className="invalid-feedback">{form.errors.redirect}</div>
											) : null}
										</div>
									</div>
								)}
							</Field>
						)}
						{values.value === "html" && (
							<>
								<Field name="html">
									{({ field, form }) => (
										<div className="mt-5 mb-3">
											<label className="form-label" htmlFor="html">
												<T id="settings.default-site.html" />
											</label>
											<div>
												<textarea
													id="html"
													className={`form-control font-monospace ${form.errors.html ? "is-invalid" : ""}`}
													spellCheck={false}
													placeholder={intl.formatMessage({
														id: "settings.default-site.html.placeholder",
													})}
													rows={14}
													{...field}
												/>
												{form.errors.html ? (
													<div className="invalid-feedback">{form.errors.html}</div>
												) : null}
											</div>
										</div>
									)}
								</Field>
								<Field name="status">
									{({ field, form }) => (
										<div className="mb-3">
											<label className="form-label" htmlFor="status">
												<T id="settings.default-site.status" />
											</label>
											<input
												id="status"
												type="number"
												min={400}
												max={599}
												placeholder="200"
												autoComplete="off"
												className={`form-control ${form.errors.status ? "is-invalid" : ""}`}
												{...field}
											/>
											{form.errors.status ? (
												<div className="invalid-feedback">{form.errors.status}</div>
											) : null}
										</div>
									)}
								</Field>
							</>
						)}
					</div>
					<SaveBar />
				</Form>
			)}
		</Formik>
	);
}
