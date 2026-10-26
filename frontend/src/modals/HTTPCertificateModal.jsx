import { useQueryClient } from "@tanstack/react-query";
import { Field, Form, Formik } from "formik";
import { useState } from "react";
import { createCertificate, testHttpCertificate } from "src/api/backend";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DomainNamesField,
	ErrorAlert,
	FormSubmit,
	NoticeAlert,
	RequestProgress,
	SwitchField,
} from "src/components";
import { DirtyTracker, useUnsavedChangesGuard } from "src/hooks";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { showObjectSuccess } from "src/notifications";

const showHTTPCertificateModal = () => {
	EasyModal.show(HTTPCertificateModal);
};

const HTTPCertificateModal = EasyModal.create(({ visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const queryClient = useQueryClient();
	const [errorMsg, setErrorMsg] = useState(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [domains, setDomains] = useState([]);
	const [isTesting, setIsTesting] = useState(false);
	const [testResults, setTestResults] = useState(null);

	const onSubmit = async (values, { setSubmitting }) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		try {
			await createCertificate(values);
			showObjectSuccess("certificate", "saved");
			remove();
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
		await queryClient.invalidateQueries({ queryKey: ["certificates"] });
		setIsSubmitting(false);
		setSubmitting(false);
	};

	const handleTest = async () => {
		setIsTesting(true);
		setErrorMsg(null);
		setTestResults(null);
		try {
			const result = await testHttpCertificate(domains);
			setTestResults(result);
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
		setIsTesting(false);
	};

	const parseTestResults = () => (
		<>
			{testResults.map((testResult) => {
				const { domain, status } = testResult;
				let messageComponent;

				switch (status) {
					case "ok":
						messageComponent = <T id="certificates.http.reachability-ok" />;
						break;
					case "no-host":
						messageComponent = <T id="certificates.http.reachability-not-resolved" />;
						break;
					case "failed":
						messageComponent = <T id="certificates.http.reachability-failed-to-check" />;
						break;
					case "404":
						messageComponent = <T id="certificates.http.reachability-404" />;
						break;
					case "wrong-data":
						messageComponent = <T id="certificates.http.reachability-wrong-data" />;
						break;
					default: {
						const code = status.slice(6);
						messageComponent = <T id="certificates.http.reachability-other" data={{ code }} />;
						break;
					}
				}

				return (
					<p key={domain}>
						<strong>{domain}:</strong> {messageComponent}
					</p>
				);
			})}
		</>
	);

	return (
		<AppModal show={visible} onHide={isSubmitting || isTesting ? undefined : close} backdrop="static">
			<Formik
				initialValues={{
					domainNames: [],
					provider: "letsencrypt",
					npmproReuseKey: false,
				}}
				onSubmit={onSubmit}
			>
				{({ values }) => (
					<Form noValidate>
						<DirtyTracker dirtyRef={dirtyRef} />
						<AppModal.Header closeButton={!(isSubmitting || isTesting)}>
							<AppModal.Title>
								<T id="object.add" tData={{ object: "lets-encrypt-via-http" }} />
							</AppModal.Title>
						</AppModal.Header>
						<AppModal.Body>
							<ErrorAlert className="mb-3" onClose={() => setErrorMsg(null)}>
								{errorMsg}
							</ErrorAlert>
							<NoticeAlert>
								<T id="certificates.http.warning" />
							</NoticeAlert>
							<DomainNamesField
								forCertificate
								onChange={(doms) => {
									setDomains(doms);
									setTestResults(null);
								}}
							/>

							<div className="divide-y">
								<Field name="npmproReuseKey" type="checkbox">
									{({ field }) => (
										<SwitchField
											id="npmproReuseKey"
											label={<T id="domains.reuse-key" />}
											{...field}
										/>
									)}
								</Field>
							</div>
							{testResults ? (
								<div className="border rounded p-3 mt-3">
									<h5>
										<T id="certificates.http.test-results" />
									</h5>
									{parseTestResults()}
								</div>
							) : null}
							<RequestProgress
								running={isSubmitting}
								propagationSeconds={values.npmproPropagationSeconds}
							/>
						</AppModal.Body>
						<AppModal.Footer>
							<Button
								className="btn-link link-secondary"
								onClick={close}
								disabled={isSubmitting || isTesting}
							>
								<T id="cancel" />
							</Button>
							<div className="d-flex flex-grow-1 align-items-center justify-content-end">
								<Button
									type="button"
									color="secondary"
									className="me-3"
									isLoading={isTesting}
									disabled={isSubmitting || domains.length === 0}
									onClick={handleTest}
								>
									<T id="test" />
								</Button>
								<FormSubmit
									color="primary"
									isLoading={isSubmitting}
									disabled={isSubmitting || isTesting}
								>
									<T id="save" />
								</FormSubmit>
							</div>
						</AppModal.Footer>
					</Form>
				)}
			</Formik>
		</AppModal>
	);
});

export { showHTTPCertificateModal };
