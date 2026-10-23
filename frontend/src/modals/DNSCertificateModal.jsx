import { useQueryClient } from "@tanstack/react-query";
import cn from "clsx";
import { Field, Form, Formik } from "formik";
import { useState } from "react";
import { createCertificate } from "src/api/backend";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DNSProviderFields,
	DomainNamesField,
	ErrorAlert,
	RequestProgress,
} from "src/components";
import { DirtyTracker, useUnsavedChangesGuard } from "src/hooks";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { showObjectSuccess } from "src/notifications";

const showDNSCertificateModal = () => {
	EasyModal.show(DNSCertificateModal);
};

const DNSCertificateModal = EasyModal.create(({ visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const queryClient = useQueryClient();
	const [errorMsg, setErrorMsg] = useState(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

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

	const toggleClasses = "form-check-input";
	const toggleEnabled = cn(toggleClasses, "bg-cyan");

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static">
			<Formik
				initialValues={{
					domainNames: [],
					provider: "letsencrypt",
					npmproDnsChallenge: true,
					npmproReuseKey: false,
				}}
				onSubmit={onSubmit}
			>
				{({ values }) => (
					<Form>
						<DirtyTracker dirtyRef={dirtyRef} />
						<AppModal.Header closeButton={!isSubmitting}>
							<AppModal.Title>
								<T id="object.add" tData={{ object: "lets-encrypt-via-dns" }} />
							</AppModal.Title>
						</AppModal.Header>
						<AppModal.Body className="p-0">
							<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
							<div className="card m-0 border-0">
								<div className="card-body">
									<DomainNamesField isWildcardPermitted dnsProviderWildcardSupported forCertificate />
									<DNSProviderFields />
									<div className="row">
										<div className="col-6">
											<Field name="npmproReuseKey">
												{({ field }) => (
													<label className="form-check form-switch mt-1">
														<input
															{...field}
															className={field.value ? toggleEnabled : toggleClasses}
															type="checkbox"
															checked={field.value}
														/>

														<span className="form-check-label">
															<T id="domains.reuse-key" />
														</span>
													</label>
												)}
											</Field>
										</div>
									</div>
								</div>
							</div>
						</AppModal.Body>
						<RequestProgress running={isSubmitting} propagationSeconds={values.npmproPropagationSeconds} />
						<AppModal.Footer>
							<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
								<T id="cancel" />
							</Button>
							<Button
								type="submit"
								color="primary"
								className="ms-auto"
								isLoading={isSubmitting}
								disabled={isSubmitting}
							>
								<T id="save" />
							</Button>
						</AppModal.Footer>
					</Form>
				)}
			</Formik>
		</AppModal>
	);
});

export { showDNSCertificateModal };
