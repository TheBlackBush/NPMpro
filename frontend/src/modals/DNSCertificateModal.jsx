import { useQueryClient } from "@tanstack/react-query";
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
	FormSubmit,
	RequestProgress,
	SwitchField,
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
					<Form noValidate>
						<DirtyTracker dirtyRef={dirtyRef} />
						<AppModal.Header closeButton={!isSubmitting}>
							<AppModal.Title>
								<T id="object.add" tData={{ object: "lets-encrypt-via-dns" }} />
							</AppModal.Title>
						</AppModal.Header>
						<AppModal.Body>
							<ErrorAlert className="mb-3" onClose={() => setErrorMsg(null)}>
								{errorMsg}
							</ErrorAlert>
							<DomainNamesField isWildcardPermitted dnsProviderWildcardSupported forCertificate />
							<DNSProviderFields />
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
							<RequestProgress
								running={isSubmitting}
								propagationSeconds={values.npmproPropagationSeconds}
							/>
						</AppModal.Body>
						<AppModal.Footer>
							<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
								<T id="cancel" />
							</Button>
							<FormSubmit
								className="ms-auto"
								color="primary"
								isLoading={isSubmitting}
								disabled={isSubmitting}
							>
								<T id="save" />
							</FormSubmit>
						</AppModal.Footer>
					</Form>
				)}
			</Formik>
		</AppModal>
	);
});

export { showDNSCertificateModal };
