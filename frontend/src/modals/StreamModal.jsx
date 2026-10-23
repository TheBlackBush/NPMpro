import { Field, Form, Formik } from "formik";
import { useState } from "react";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DirectoryField,
	ErrorAlert,
	HasPermission,
	Loading,
	NginxConfigField,
	RequestProgress,
	SSLCertificateField,
	SSLOptionsFields,
	SwitchField,
} from "src/components";
import {
	DirtyTracker,
	useDirectorySuggestions,
	useSetStream,
	useStream,
	useStreams,
	useUnsavedChangesGuard,
} from "src/hooks";
import { intl, T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { MANAGE, STREAMS } from "src/modules/Permissions";
import { showTabOfInvalid, validateString } from "src/modules/Validations";
import { getNginxConfigError, NginxConfigErrorMsg, showObjectSuccess } from "src/notifications";

const showStreamModal = (id) => {
	EasyModal.show(StreamModal, { id });
};

// without a certificate "TLS to upstream" would downgrade the stream to plain text
const isProxyTlsPossible = (values) =>
	!values.udpForwarding && (values.certificateId === "new" || values.certificateId > 0);

const StreamModal = EasyModal.create(({ id, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { data, isPending, error } = useStream(id);
	const { data: allStreams } = useStreams();
	const suggestions = useDirectorySuggestions(allStreams);
	const { mutate: setStream } = useSetStream();
	const [errorMsg, setErrorMsg] = useState(null);
	// set once a new host was created but its nginx config failed, so saving again updates it
	const [savedId, setSavedId] = useState(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const onSubmit = (values, { resetForm, setSubmitting }) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		const payload = {
			id: savedId ?? (id === "new" ? undefined : id),
			...values,
			domainNames: values.certificateId === "new" ? values.domainNames : undefined,
			npmproProxyTls: values.npmproProxyTls && isProxyTlsPossible(values),
		};

		setStream(payload, {
			onError: (err) => {
				setErrorMsg(<ApiErrorContent error={err} />);
			},
			onSuccess: (row) => {
				const nginxErr = getNginxConfigError(row);
				if (nginxErr === null) {
					showObjectSuccess("stream", "saved");
					remove();
					return;
				}
				setSavedId(row.id);
				// the changes are saved, only the nginx config needs fixing. Keep the certificate the backend
				// created, otherwise saving again with "new" would request another one
				resetForm({ values: { ...values, certificateId: row.certificateId } });
				setErrorMsg(<NginxConfigErrorMsg obj="stream" nginxErr={nginxErr} />);
			},
			onSettled: () => {
				setIsSubmitting(false);
				setSubmitting(false);
			},
		});
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static">
			{error && <ErrorAlert error={error} className="m-3" />}
			{isPending && <Loading noLogo />}
			{data && (
				<Formik
					initialValues={{
						incomingPort: data?.incomingPort,
						forwardingHost: data?.forwardingHost,
						forwardingPort: data?.forwardingPort,
						tcpForwarding: data?.tcpForwarding,
						udpForwarding: data?.udpForwarding,
						npmproProxyProtocolForwarding: data?.npmproProxyProtocolForwarding,
						npmproProxyTls: data?.npmproProxyTls,
						certificateId: data?.certificateId,
						npmproAdvancedConfig: data?.npmproAdvancedConfig,
						npmproDirectory: data?.npmproDirectory,
						npmproMtlsCertificateId: data?.npmproMtlsCertificateId,
						npmproMtlsVerifyClientOptional: data?.npmproMtlsVerifyClientOptional,
						npmproDescription: data?.npmproDescription,
					}}
					onSubmit={onSubmit}
				>
					{({ values, setFieldValue }) => (
						<Form onInvalid={showTabOfInvalid}>
							<DirtyTracker dirtyRef={dirtyRef} />
							<AppModal.Header closeButton={!isSubmitting}>
								<AppModal.Title>
									<T
										id={savedId || data?.id ? "object.edit" : "object.add"}
										tData={{ object: "stream" }}
									/>
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
													href="#tab-ssl"
													className={`nav-link ${values.udpForwarding ? "disabled" : ""}`}
													data-bs-toggle={values.udpForwarding ? undefined : "tab"}
													aria-selected="false"
													aria-disabled={values.udpForwarding}
													role="tab"
												>
													<T id="column.ssl" />
												</a>
											</li>
											<li className="nav-item" role="presentation">
												<a
													href="#tab-advanced"
													className="nav-link"
													data-bs-toggle="tab"
													aria-selected="false"
													role="tab"
												>
													<T id="domains.advanced" />
													{values?.npmproAdvancedConfig?.trim() ? "*" : ""}
												</a>
											</li>
										</ul>
									</div>
									<div className="card-body">
										<div className="tab-content">
											<div className="tab-pane active show" id="tab-details" role="tabpanel">
												<Field name="incomingPort" validate={validateString(1, 11)}>
													{({ field, form }) => (
														<div className="mb-3">
															<label className="form-label" htmlFor="incomingPort">
																<T id="stream.incoming-port" />
															</label>
															<input
																id="incomingPort"
																type="text"
																minLength={1}
																maxLength={11}
																pattern="[0-9]{1,5}(-[0-9]{1,5})?"
																className={`form-control ${form.errors.incomingPort && form.touched.incomingPort ? "is-invalid" : ""}`}
																required
																placeholder={intl.formatMessage(
																	{ id: "form.example" },
																	{ example: "8080" },
																)}
																{...field}
															/>

															{form.errors.incomingPort ? (
																<div className="invalid-feedback">
																	{form.touched.incomingPort
																		? form.errors.incomingPort
																		: null}
																</div>
															) : null}
														</div>
													)}
												</Field>
												<Field name="npmproDescription" validate={validateString(0, 255)}>
													{({ field, form }) => (
														<div className="mb-3">
															<label className="form-label" htmlFor="npmproDescription">
																<T id="stream.description" />
															</label>
															<input
																id="npmproDescription"
																type="text"
																maxLength={255}
																className={`form-control ${form.errors.npmproDescription && form.touched.npmproDescription ? "is-invalid" : ""}`}
																placeholder={intl.formatMessage({
																	id: "stream.description.placeholder",
																})}
																{...field}
															/>

															{form.errors.npmproDescription ? (
																<div className="invalid-feedback">
																	{form.touched.npmproDescription
																		? form.errors.npmproDescription
																		: null}
																</div>
															) : null}
														</div>
													)}
												</Field>
												<div className="row">
													<div className="col-md-8">
														<Field name="forwardingHost" validate={validateString(1, 253)}>
															{({ field, form }) => (
																<div className="mb-3">
																	<label
																		className="form-label"
																		htmlFor="forwardingHost"
																	>
																		<T id="stream.forward-host" />
																	</label>
																	<input
																		id="forwardingHost"
																		type="text"
																		className={`form-control ${form.errors.forwardingHost && form.touched.forwardingHost ? "is-invalid" : ""}`}
																		required
																		pattern="\S+"
																		placeholder={intl.formatMessage({
																			id: "stream.forward-host.placeholder",
																		})}
																		{...field}
																	/>

																	{form.errors.forwardingHost ? (
																		<div className="invalid-feedback">
																			{form.touched.forwardingHost
																				? form.errors.forwardingHost
																				: null}
																		</div>
																	) : null}
																</div>
															)}
														</Field>
													</div>
													<div className="col-md-4">
														<Field name="forwardingPort" validate={validateString(0, 12)}>
															{({ field, form }) => (
																<div className="mb-3">
																	<label
																		className="form-label"
																		htmlFor="forwardingPort"
																	>
																		<T id="host.forward-port" />
																	</label>
																	<input
																		id="forwardingPort"
																		type="text"
																		maxLength={12}
																		pattern="[0-9]{0,5}|\$server_port"
																		className={`form-control ${form.errors.forwardingPort && form.touched.forwardingPort ? "is-invalid" : ""}`}
																		placeholder={intl.formatMessage(
																			{ id: "form.example" },
																			{ example: "8081" },
																		)}
																		{...field}
																	/>

																	{form.errors.forwardingPort ? (
																		<div className="invalid-feedback">
																			{form.touched.forwardingPort
																				? form.errors.forwardingPort
																				: null}
																		</div>
																	) : null}
																</div>
															)}
														</Field>
													</div>
												</div>
												<div className="my-3">
													<h3 className="py-2">
														<T id="host.flags.protocols" />
													</h3>
													<div className="divide-y">
														<div>
															<Field name="tcpForwarding" type="checkbox">
																{({ field }) => (
																	<SwitchField
																		id="tcpForwarding"
																		label={<T id="streams.tcp" />}
																		name={field.name}
																		checked={field.value}
																		onChange={(e) => {
																			setFieldValue(field.name, e.target.checked);
																			if (!e.target.checked) {
																				setFieldValue("udpForwarding", true);
																				if (
																					values.npmproProxyProtocolForwarding ===
																					1
																				) {
																					setFieldValue(
																						"npmproProxyProtocolForwarding",
																						0,
																					);
																				}
																				setFieldValue("npmproProxyTls", false);
																				setFieldValue("certificateId", 0);
																				setFieldValue(
																					"npmproMtlsCertificateId",
																					0,
																				);
																				setFieldValue(
																					"npmproMtlsVerifyClientOptional",
																					false,
																				);
																			}
																		}}
																	/>
																)}
															</Field>
														</div>
														<div>
															<Field name="udpForwarding" type="checkbox">
																{({ field }) => (
																	<SwitchField
																		id="udpForwarding"
																		label={<T id="streams.udp" />}
																		name={field.name}
																		checked={field.value}
																		onChange={(e) => {
																			setFieldValue(field.name, e.target.checked);

																			if (e.target.checked) {
																				if (
																					values.npmproProxyProtocolForwarding ===
																					1
																				) {
																					setFieldValue(
																						"npmproProxyProtocolForwarding",
																						0,
																					);
																				}
																				setFieldValue("npmproProxyTls", false);
																				setFieldValue("certificateId", 0);
																				setFieldValue(
																					"npmproMtlsCertificateId",
																					0,
																				);
																				setFieldValue(
																					"npmproMtlsVerifyClientOptional",
																					false,
																				);
																			}

																			if (!e.target.checked) {
																				setFieldValue("tcpForwarding", true);
																			}
																		}}
																	/>
																)}
															</Field>
														</div>
														<div>
															<Field name="npmproProxyTls" type="checkbox">
																{({ field }) => (
																	<SwitchField
																		id="npmproProxyTls"
																		label={<T id="streams.tls" />}
																		hint={
																			!values.udpForwarding &&
																			!isProxyTlsPossible(values) && (
																				<span className="d-block">
																					<T id="streams.tls.requires-certificate" />
																				</span>
																			)
																		}
																		name={field.name}
																		checked={
																			field.value && isProxyTlsPossible(values)
																		}
																		disabled={!isProxyTlsPossible(values)}
																		onChange={(e) => {
																			setFieldValue(field.name, e.target.checked);
																		}}
																	/>
																)}
															</Field>
														</div>
													</div>
													<div className="mt-3 mb-3">
														<label
															className="form-label"
															htmlFor="npmproProxyProtocolForwarding"
														>
															<T id="streams.pp" />
														</label>
														<Field name="npmproProxyProtocolForwarding">
															{({ field }) => (
																<select
																	id="npmproProxyProtocolForwarding"
																	className="form-select"
																	required
																	{...field}
																	onChange={(e) =>
																		setFieldValue(
																			field.name,
																			Number(e.target.value),
																		)
																	}
																>
																	<option value={0}>
																		{intl.formatMessage({
																			id: "streams.pp.off",
																		})}
																	</option>
																	{values.tcpForwarding && !values.udpForwarding ? (
																		<option value={1}>
																			{intl.formatMessage({
																				id: "streams.pp.v1",
																			})}
																		</option>
																	) : null}
																	<option value={2}>
																		{intl.formatMessage({
																			id: "streams.pp.v2",
																		})}
																	</option>
																</select>
															)}
														</Field>
													</div>
												</div>
											</div>
											<div className="tab-pane" id="tab-ssl" role="tabpanel">
												<SSLCertificateField
													name="certificateId"
													label="ssl-certificate"
													allowNew
													forHttp={false}
												/>

												<SSLOptionsFields forHttp={false} />
											</div>
											<div className="tab-pane" id="tab-advanced" role="tabpanel">
												<NginxConfigField
													name="npmproAdvancedConfig"
													id="npmproAdvancedConfig"
												/>

												<div className="row mt-3">
													<div className="col-md-12 mb-3">
														<DirectoryField
															labelId="stream.directory"
															datalistId="directory-suggestions-stream"
															suggestions={suggestions}
														/>
													</div>
												</div>
											</div>
										</div>
									</div>
								</div>
								<RequestProgress
									className="px-3 pb-3"
									running={isSubmitting && values.certificateId === "new"}
									propagationSeconds={values.npmproPropagationSeconds}
								/>
							</AppModal.Body>
							<AppModal.Footer>
								<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
									<T id="cancel" />
								</Button>
								<HasPermission section={STREAMS} permission={MANAGE} hideError>
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

export { showStreamModal };
