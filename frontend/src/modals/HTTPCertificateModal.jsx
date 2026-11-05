import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useWatch } from "react-hook-form";
import { createCertificate, testHttpCertificate } from "src/api/backend";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DomainNamesField,
	ErrorAlert,
	FormSubmit,
	HookForm,
	NoticeAlert,
	RequestProgress,
	SwitchField,
	SwitchList,
	useAppForm,
} from "src/components";
import { DirtyTracker, useUnsavedChangesGuard } from "src/hooks";
import { cn } from "src/lib/utils";
import { T } from "src/locale";
import { httpCertificateValidate, reachabilityMessage } from "src/modules/CertificateForms";
import EasyModal from "src/modules/easyModal";
import { sectionAccent } from "src/modules/SectionAccents";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { sectionIcon } from "src/shell/useNavItems";

const showHTTPCertificateModal = () => {
	EasyModal.show(HTTPCertificateModal);
};

const validate = httpCertificateValidate(validations);
const accent = sectionAccent("certificates");
const Icon = sectionIcon("certificates");

const HTTPCertificateModal = EasyModal.create(({ visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const queryClient = useQueryClient();
	const [errorMsg, setErrorMsg] = useState(null);
	const [isTesting, setIsTesting] = useState(false);
	const [testResults, setTestResults] = useState(null);
	const methods = useAppForm({
		defaultValues: { domainNames: [], provider: "letsencrypt", npmproReuseKey: false },
		validate,
	});
	const { isSubmitting } = methods.formState;
	const domains = useWatch({ control: methods.control, name: "domainNames" });

	const onSubmit = async (values) => {
		setErrorMsg(null);

		try {
			await createCertificate(values);
			showObjectSuccess("certificate", "saved");
			remove();
			await queryClient.invalidateQueries({ queryKey: ["certificates"] });
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
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
				const message = reachabilityMessage(status);

				return (
					<p key={domain}>
						<strong>{domain}:</strong> <T id={message.id} data={message.data} />
					</p>
				);
			})}
		</>
	);

	return (
		<AppModal show={visible} onHide={isSubmitting || isTesting ? undefined : close} backdrop="static">
			<HookForm methods={methods} onSubmit={onSubmit}>
				<DirtyTracker dirtyRef={dirtyRef} />
				<AppModal.Header closeButton={!(isSubmitting || isTesting)}>
					<AppModal.Title className="flex items-center gap-2">
						{Icon ? <Icon className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" /> : null}
						<T id="object.add" tData={{ object: "lets-encrypt-via-http" }} />
					</AppModal.Title>
				</AppModal.Header>
				<AppModal.Body>
					<ErrorAlert className="mb-3" onClose={() => setErrorMsg(null)}>
						{errorMsg}
					</ErrorAlert>
					<NoticeAlert className="mb-3">
						<T id="certificates.http.warning" />
					</NoticeAlert>
					<DomainNamesField forCertificate onChange={() => setTestResults(null)} />

					<SwitchList>
						<SwitchField
							id="npmproReuseKey"
							label={<T id="domains.reuse-key" />}
							{...methods.register("npmproReuseKey")}
						/>
					</SwitchList>
					{testResults ? (
						<div className="border rounded p-3 mt-3">
							<h5>
								<T id="certificates.http.test-results" />
							</h5>
							{parseTestResults()}
						</div>
					) : null}
					<RequestProgress running={isSubmitting} />
				</AppModal.Body>
				<AppModal.Footer>
					<Button variant="ghost" onClick={close} disabled={isSubmitting || isTesting}>
						<T id="cancel" />
					</Button>
					<div className="flex min-w-0 flex-1 items-center justify-end gap-3">
						<Button
							type="button"
							color="secondary"
							// the footer keeps the focus on mousedown; Test blurs first so a typed domain becomes a chip
							data-blur-first=""
							isLoading={isTesting}
							disabled={isSubmitting || domains.length === 0}
							onClick={handleTest}
						>
							<T id="test" />
						</Button>
						<FormSubmit isLoading={isSubmitting} disabled={isSubmitting || isTesting}>
							<T id="save" />
						</FormSubmit>
					</div>
				</AppModal.Footer>
			</HookForm>
		</AppModal>
	);
});

export { showHTTPCertificateModal };
