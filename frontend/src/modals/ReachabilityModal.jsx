import { useEffect, useState } from "react";
import { testHttpCertificate } from "src/api/backend";
import { ApiErrorContent, AppModal, ErrorAlert, Loading } from "src/components";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";

const showReachabilityModal = (domains) => {
	EasyModal.show(ReachabilityModal, { domains });
};

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
		<AppModal show={visible} onHide={remove}>
			<AppModal.Header closeButton>
				<AppModal.Title>
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
