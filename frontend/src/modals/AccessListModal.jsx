import cn from "clsx";
import { Field, Form, Formik } from "formik";
import { useState } from "react";
import {
	AccessClientFields,
	ApiErrorContent,
	AppModal,
	BasicAuthFields,
	Button,
	ErrorAlert,
	HasPermission,
	Loading,
} from "src/components";
import { DirtyTracker, useAccessList, useSetAccessList, useUnsavedChangesGuard } from "src/hooks";
import { intl, T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { ACCESS_LISTS, MANAGE } from "src/modules/Permissions";
import { showTabOfInvalid, validateString } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const showAccessListModal = (id) => {
	EasyModal.show(AccessListModal, { id });
};

const AccessListModal = EasyModal.create(({ id, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { data, isPending, error } = useAccessList(id);
	const { mutate: setAccessList } = useSetAccessList();
	const [errorMsg, setErrorMsg] = useState(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const validate = (values) => {
		// either Auths or Clients must be defined
		if (values.items.length === 0 && values.clients.every((c) => c.address.trim().toLowerCase() === "all")) {
			return intl.formatMessage({ id: "error.access.at-least-one" });
		}

		// ensure the items don't contain the same username twice
		const usernames = values.items.map((i) => i.username);
		const uniqueUsernames = Array.from(new Set(usernames));
		if (usernames.length !== uniqueUsernames.length) {
			return intl.formatMessage({ id: "error.access.duplicate-usernames" });
		}

		return null;
	};

	const onSubmit = (values, { setSubmitting }) => {
		if (isSubmitting) return;

		const vErr = validate(values);
		if (vErr) {
			setErrorMsg(vErr);
			return;
		}

		setIsSubmitting(true);
		setErrorMsg(null);

		const payload = {
			id: id === "new" ? undefined : id,
			...values,
		};

		// Filter out "items" to only use the "username" and "password" fields
		payload.items = values.items.map((i) => ({
			username: i.username,
			password: i.password,
		}));

		// Filter out "clients" to only use the "directive" and "address" fields
		payload.clients = values.clients.map((i) => ({
			directive: i.directive,
			address: i.address,
		}));

		setAccessList(payload, {
			onError: (err) => setErrorMsg(<ApiErrorContent error={err} />),
			onSuccess: () => {
				showObjectSuccess("access-list", "saved");
				remove();
			},
			onSettled: () => {
				setIsSubmitting(false);
				setSubmitting(false);
			},
		});
	};

	const toggleClasses = "form-check-input";
	const toggleEnabled = cn(toggleClasses, "bg-cyan");

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static">
			{error && <ErrorAlert error={error} className="m-3" />}
			{isPending && <Loading noLogo />}
			{data && (
				<Formik
					initialValues={{
						name: data?.name,
						satisfyAny: data?.satisfyAny,
						passAuth: data?.passAuth,
						items: data?.items,
						clients: data?.clients,
					}}
					onSubmit={onSubmit}
				>
					{({ setFieldValue }) => (
						<Form onInvalid={showTabOfInvalid}>
							<DirtyTracker dirtyRef={dirtyRef} />
							<AppModal.Header closeButton={!isSubmitting}>
								<AppModal.Title>
									<T id={data?.id ? "object.edit" : "object.add"} tData={{ object: "access-list" }} />
								</AppModal.Title>
							</AppModal.Header>
							<AppModal.Body className="p-0">
								<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
								<div className="card m-0 border-0">
									<div className="card-header">
										<ul className="nav nav-tabs card-header-tabs" data-bs-toggle="tabs">
											<li className="nav-item" role="presentation">
												<a
													href="#tab-details"
													className="nav-link active"
													data-bs-toggle="tab"
													aria-selected="true"
													role="tab"
												>
													<T id="column.details" />
												</a>
											</li>
											<li className="nav-item" role="presentation">
												<a
													href="#tab-auth"
													className="nav-link"
													data-bs-toggle="tab"
													aria-selected="false"
													role="tab"
												>
													<T id="column.authorizations" />
												</a>
											</li>
											<li className="nav-item" role="presentation">
												<a
													href="#tab-rules"
													className="nav-link"
													data-bs-toggle="tab"
													aria-selected="false"
													role="tab"
												>
													<T id="column.rules" />
												</a>
											</li>
										</ul>
									</div>
									<div className="card-body">
										<div className="tab-content">
											<div className="tab-pane active show" id="tab-details" role="tabpanel">
												<Field name="name" validate={validateString(1, 255)}>
													{({ field, form }) => (
														<div>
															<label htmlFor="name" className="form-label">
																<T id="column.name" />
															</label>
															<input
																id="name"
																type="text"
																required
																autoComplete="off"
																className={`form-control ${form.errors.name && form.touched.name ? "is-invalid" : ""}`}
																{...field}
															/>

															{form.errors.name ? (
																<div className="invalid-feedback">
																	{form.touched.name ? form.errors.name : null}
																</div>
															) : null}
														</div>
													)}
												</Field>
												<div className="my-3">
													<h3 className="py-2">
														<T id="options" />
													</h3>
													<div className="divide-y">
														<div>
															<label className="row cursor-pointer" htmlFor="satisfyAny">
																<span className="col">
																	<T id="access-list.satisfy-any" />
																</span>
																<span className="col-auto">
																	<Field name="satisfyAny" type="checkbox">
																		{({ field }) => (
																			<span className="form-check form-check-single form-switch">
																				<input
																					id="satisfyAny"
																					className={
																						field.value
																							? toggleEnabled
																							: toggleClasses
																					}
																					type="checkbox"
																					name={field.name}
																					checked={field.value}
																					onChange={(e) => {
																						setFieldValue(
																							field.name,
																							e.target.checked,
																						);
																					}}
																				/>
																			</span>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label className="row cursor-pointer" htmlFor="passAuth">
																<span className="col">
																	<T id="access-list.pass-auth" />
																</span>
																<span className="col-auto">
																	<Field name="passAuth" type="checkbox">
																		{({ field }) => (
																			<span className="form-check form-check-single form-switch">
																				<input
																					id="passAuth"
																					className={
																						field.value
																							? toggleEnabled
																							: toggleClasses
																					}
																					type="checkbox"
																					name={field.name}
																					checked={field.value}
																					onChange={(e) => {
																						setFieldValue(
																							field.name,
																							e.target.checked,
																						);
																					}}
																				/>
																			</span>
																		)}
																	</Field>
																</span>
															</label>
														</div>
													</div>
												</div>
											</div>
											<div className="tab-pane" id="tab-auth" role="tabpanel">
												<BasicAuthFields initialValues={data?.items} />
											</div>
											<div className="tab-pane" id="tab-rules" role="tabpanel">
												<AccessClientFields initialValues={data?.clients} />
											</div>
										</div>
									</div>
								</div>
							</AppModal.Body>
							<AppModal.Footer>
								<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
									<T id="cancel" />
								</Button>
								<HasPermission section={ACCESS_LISTS} permission={MANAGE} hideError>
									<Button
										type="submit"
										color="primary"
										className="ms-auto"
										isLoading={isSubmitting}
										disabled={isSubmitting}
									>
										<T id="save" />
									</Button>
								</HasPermission>
							</AppModal.Footer>
						</Form>
					)}
				</Formik>
			)}
		</AppModal>
	);
});

export { showAccessListModal };
