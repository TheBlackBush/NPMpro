import { Field, Form, Formik } from "formik";
import { useState } from "react";
import { ApiErrorContent, Button, ErrorAlert, Loading } from "src/components";
import { useSetSetting, useSetting } from "src/hooks";
import { intl, T } from "src/locale";
import { validateString } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const OPTIONS = ["congratulations", "404", "444", "redirect", "html"];

export default function DefaultSite() {
	const { data, isPending, error } = useSetting("default-site");
	const { mutate: setSetting } = useSetSetting();
	const [errorMsg, setErrorMsg] = useState(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const onSubmit = (values, { setSubmitting }) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		const payload = {
			id: "default-site",
			value: values.value,
			meta: {
				redirect: values.redirect,
				html: values.html,
				status: values.status || undefined,
			},
		};

		setSetting(payload, {
			onError: (err) => setErrorMsg(<ApiErrorContent error={err} />),
			onSuccess: () => {
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
				<h3 className="card-title mb-3">
					<T id="settings.default-site" />
				</h3>
				<div className="mb-3">
					<ErrorAlert error={error} />
				</div>
			</div>
		);
	}

	if (isPending) {
		return (
			<div className="card-body">
				<h3 className="card-title mb-3">
					<T id="settings.default-site" />
				</h3>
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
			onSubmit={onSubmit}
		>
			{({ values }) => (
				<Form className="d-flex flex-column flex-fill">
					<div className="card-body flex-fill">
						<h3 className="card-title mb-3">
							<T id="settings.default-site" />
						</h3>
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
							<Field name="redirect" validate={validateString(1, 255)}>
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
												required
												pattern="\S+"
												autoComplete="off"
												className={`form-control ${form.errors.redirect && form.touched.redirect ? "is-invalid" : ""}`}
												{...field}
											/>

											{form.errors.redirect ? (
												<div className="invalid-feedback">
													{form.touched.redirect ? form.errors.redirect : null}
												</div>
											) : null}
										</div>
									</div>
								)}
							</Field>
						)}
						{values.value === "html" && (
							<>
								<Field name="html">
									{({ field }) => (
										<div className="mt-5 mb-3">
											<label className="form-label" htmlFor="html">
												<T id="settings.default-site.html" />
											</label>
											<div>
												<textarea
													id="html"
													required
													className="form-control font-monospace"
													spellCheck={false}
													placeholder={intl.formatMessage({
														id: "settings.default-site.html.placeholder",
													})}
													rows={14}
													{...field}
												/>
											</div>
										</div>
									)}
								</Field>
								<Field name="status">
									{({ field }) => (
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
												className="form-control"
												{...field}
											/>
										</div>
									)}
								</Field>
							</>
						)}
					</div>
					<div className="card-footer text-end">
						<Button type="submit" color="teal" isLoading={isSubmitting} disabled={isSubmitting}>
							<T id="save" />
						</Button>
					</div>
				</Form>
			)}
		</Formik>
	);
}
