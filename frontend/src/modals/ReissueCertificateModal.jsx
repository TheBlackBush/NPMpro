import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useWatch } from "react-hook-form";
import { reissueCertificate } from "src/api/backend";
import {
	AcmeServerField,
	ApiErrorContent,
	AppModal,
	Button,
	ErrorAlert,
	FormSubmit,
	HookForm,
	NoticeAlert,
	RequestProgress,
	useAppForm,
} from "src/components";
import { useAcmeServers } from "src/hooks";
import { cn } from "src/lib/utils";
import { T } from "src/locale";
import { caOptions, isTestCa } from "src/modules/AcmeServers";
import EasyModal from "src/modules/easyModal";
import { sectionAccent } from "src/modules/SectionAccents";
import { showObjectSuccess } from "src/notifications";
import { sectionIcon } from "src/shell/useNavItems";

const showReissueCertificateModal = (certificate) => {
	EasyModal.show(ReissueCertificateModal, { certificate });
};

const accent = sectionAccent("certificates");
const Icon = sectionIcon("certificates");

const ReissueCertificateModal = EasyModal.create(({ certificate, visible, remove }) => {
	const queryClient = useQueryClient();
	const { data: servers, isPending, error } = useAcmeServers();
	const [errorMsg, setErrorMsg] = useState(null);
	const methods = useAppForm({ defaultValues: { npmproAcmeServer: "" } });
	const { isSubmitting } = methods.formState;
	const chosen = useWatch({ control: methods.control, name: "npmproAcmeServer" });
	const hasOther = caOptions(servers, certificate.npmproAcmeServer).length > 0;

	const onSubmit = async (values) => {
		// Enter in the window submits too: nothing happens until a CA is chosen, like the disabled button
		if (!values.npmproAcmeServer) return;
		setErrorMsg(null);
		try {
			await reissueCertificate(certificate.id, values.npmproAcmeServer);
			showObjectSuccess("certificate", "updated");
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["certificates"] }),
				queryClient.invalidateQueries({ queryKey: ["certificate", certificate.id] }),
			]);
			remove();
		} catch (err) {
			// the window stays open: a failed request leaves the certificate as it was
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal size="sm" show={visible} onHide={isSubmitting ? undefined : remove} backdrop="static">
			<HookForm methods={methods} onSubmit={onSubmit}>
				<AppModal.Header closeButton={!isSubmitting}>
					<AppModal.Title className="flex items-center gap-2">
						{Icon ? <Icon className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" /> : null}
						<T id="certificate.reissue" />
					</AppModal.Title>
				</AppModal.Header>
				<AppModal.Body>
					{error ? (
						<ErrorAlert error={error} />
					) : isPending || hasOther ? (
						<>
							<p className="mb-3 text-muted-foreground">
								<T id="certificate.reissue.note" />
							</p>
							<AcmeServerField exclude={certificate.npmproAcmeServer ?? undefined} />
							{isTestCa(chosen) ? (
								<NoticeAlert className="mt-3">
									<T id="certificate.reissue.test-ca" />
								</NoticeAlert>
							) : null}
						</>
					) : (
						<NoticeAlert variant="info">
							<T id="certificate.reissue.no-other-ca" />
						</NoticeAlert>
					)}
					<RequestProgress running={isSubmitting} propagationSeconds={certificate.npmproPropagationSeconds} />
					<ErrorAlert className="mt-3" onClose={() => setErrorMsg(null)}>
						{errorMsg}
					</ErrorAlert>
				</AppModal.Body>
				<AppModal.Footer>
					<Button variant="ghost" onClick={remove} disabled={isSubmitting}>
						<T id="cancel" />
					</Button>
					<FormSubmit isLoading={isSubmitting} disabled={isSubmitting || !hasOther || !chosen}>
						<T id="action.reissue" />
					</FormSubmit>
				</AppModal.Footer>
			</HookForm>
		</AppModal>
	);
});

export { showReissueCertificateModal };
