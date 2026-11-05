import { useEffect, useState } from "react";
import { testHttpCertificate } from "src/api/backend";
import { ApiErrorContent, AppModal, ErrorAlert, Loading } from "src/components";
import { cn } from "src/lib/utils";
import { T } from "src/locale";
import { reachabilityMessage } from "src/modules/CertificateForms";
import EasyModal from "src/modules/easyModal";
import { sectionAccent } from "src/modules/SectionAccents";
import { sectionIcon } from "src/shell/useNavItems";

const showReachabilityModal = (domains) => {
	EasyModal.show(ReachabilityModal, { domains });
};

const accent = sectionAccent("certificates");
const Icon = sectionIcon("certificates");

const ReachabilityModal = EasyModal.create(({ visible, remove, domains }) => {
	const [errorMsg, setErrorMsg] = useState(null);
	const [testResults, setTestResults] = useState(null);

	useEffect(() => {
		const handleTest = async () => {
			setErrorMsg(null);
			setTestResults(null);
			try {
				const result = await testHttpCertificate(domains);
				setTestResults(result);
			} catch (err) {
				setErrorMsg(<ApiErrorContent error={err} />);
			}
		};

		void handleTest();
	}, [domains]);

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
		<AppModal size="sm" show={visible} onHide={remove}>
			<AppModal.Header closeButton>
				<AppModal.Title className="flex items-center gap-2">
					{Icon ? <Icon className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" /> : null}
					<T id="certificates.http.test-results" />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert>{errorMsg}</ErrorAlert>
				{testResults ? parseTestResults() : !errorMsg && <Loading noLogo />}
			</AppModal.Body>
		</AppModal>
	);
});

export { showReachabilityModal };
