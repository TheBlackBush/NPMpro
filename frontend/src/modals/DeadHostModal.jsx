import { Form, Formik } from "formik";
import { useState } from "react";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DirectoryField,
	DomainNamesField,
	ErrorAlert,
	FormErrorNote,
	HasPermission,
	Loading,
	NginxConfigField,
	RequestProgress,
	SSLCertificateField,
	SSLOptionsFields,
} from "src/components";
import {
	DirtyTracker,
	useDeadHost,
	useDeadHosts,
	useDirectorySuggestions,
	useSetDeadHost,
	useUnsavedChangesGuard,
} from "src/hooks";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { DEAD_HOSTS, MANAGE } from "src/modules/Permissions";
import { showTabOfInvalid } from "src/modules/Validations";
import { getNginxConfigError, NginxConfigErrorMsg, showObjectSuccess } from "src/notifications";

const showDeadHostModal = (id) => {
	EasyModal.show(DeadHostModal, { id });
};

const DeadHostModal = EasyModal.create(({ id, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { data, isPending, error } = useDeadHost(id);
	const { mutate: setDeadHost } = useSetDeadHost();
	const { data: allDeadHosts } = useDeadHosts();
	const suggestions = useDirectorySuggestions(allDeadHosts);
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
		};

		setDeadHost(payload, {
			onError: (err) => {
				setErrorMsg(<ApiErrorContent error={err} />);
			},
			onSuccess: (row) => {
				const nginxErr = getNginxConfigError(row);
				if (nginxErr === null) {
					showObjectSuccess("dead-host", "saved");
					remove();
					return;
				}
				setSavedId(row.id);
				// the changes are saved, only the nginx config needs fixing. Keep the certificate the backend
				// created, otherwise saving again with "new" would request another one
				resetForm({ values: { ...values, certificateId: row.certificateId } });
				setErrorMsg(<NginxConfigErrorMsg obj="dead-host" nginxErr={nginxErr} />);
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
						domainNames: data?.domainNames,
						certificateId: data?.certificateId,
						sslForced: data?.sslForced,
						advancedConfig: data?.advancedConfig,
						npmproHttp3Support: data?.npmproHttp3Support,
						hstsEnabled: data?.hstsEnabled,
						hstsSubdomains: data?.hstsSubdomains,
						npmproDirectory: data?.npmproDirectory,
						npmproMtlsCertificateId: data?.npmproMtlsCertificateId,
						npmproMtlsVerifyClientOptional: data?.npmproMtlsVerifyClientOptional,
					}}
					onSubmit={onSubmit}
				>
					{({ values }) => (
						<Form onInvalid={showTabOfInvalid}>
							<DirtyTracker dirtyRef={dirtyRef} />
							<AppModal.Header closeButton={!isSubmitting}>
								<AppModal.Title>
									<T
										id={savedId || data?.id ? "object.edit" : "object.add"}
										tData={{ object: "dead-host" }}
									/>
								</AppModal.Title>
							</AppModal.Header>
							<AppModal.Body>
								<ErrorAlert className="mb-3" onClose={() => setErrorMsg(null)}>
									{errorMsg}
								</ErrorAlert>
								<ul className="nav nav-tabs mb-3" data-bs-toggle="tabs">
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
											className="nav-link"
											data-bs-toggle="tab"
											aria-selected="false"
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
											{values?.advancedConfig?.trim() ? "*" : ""}
										</a>
									</li>
								</ul>
								<div className="tab-content">
									<div className="tab-pane active show" id="tab-details" role="tabpanel">
										<DomainNamesField
											isWildcardPermitted={
												values.certificateId !== "new" || values.npmproDnsChallenge
											}
											dnsProviderWildcardSupported
											forCertificate={values.certificateId === "new"}
										/>
									</div>
									<div className="tab-pane" id="tab-ssl" role="tabpanel">
										<SSLCertificateField name="certificateId" label="ssl-certificate" allowNew />

										<SSLOptionsFields />
									</div>
									<div className="tab-pane" id="tab-advanced" role="tabpanel">
										<NginxConfigField />
										<div className="row mt-3">
											<div className="col-md-12 mb-3">
												<DirectoryField
													labelId="dead-host.directory"
													datalistId="directory-suggestions-dead"
													suggestions={suggestions}
												/>
											</div>
										</div>
									</div>
								</div>
								<RequestProgress
									running={isSubmitting && values.certificateId === "new"}
									propagationSeconds={values.npmproPropagationSeconds}
								/>
							</AppModal.Body>
							<AppModal.Footer>
								<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
									<T id="cancel" />
								</Button>
								<FormErrorNote className="ms-auto me-3" />
								<HasPermission section={DEAD_HOSTS} permission={MANAGE} hideError>
									<Button
										type="submit"
										color="primary"
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

export { showDeadHostModal };
