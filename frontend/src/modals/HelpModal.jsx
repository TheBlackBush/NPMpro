import Markdown from "markdown-to-jsx";
import { useEffect, useState } from "react";
import { AppModal, ErrorAlert, Loading } from "src/components";
import { getHelpFile, T } from "src/locale";
import EasyModal from "src/modules/easyModal";

const showHelpModal = (section) => {
	EasyModal.show(HelpModal, { section });
};

const HelpModal = EasyModal.create(({ section, visible, remove }) => {
	const [markdownText, setMarkdownText] = useState(null);
	const [error, setError] = useState(null);

	// the cleanup ignores a late result after the window closed or the section changed
	useEffect(() => {
		let current = true;
		setMarkdownText(null);
		setError(null);
		getHelpFile(section).then(
			(text) => current && setMarkdownText(text),
			(err) => current && setError(err.message),
		);
		return () => {
			current = false;
		};
	}, [section]);

	return (
		<AppModal show={visible} onHide={remove} size="lg" scrollable>
			<AppModal.Header closeButton>
				<AppModal.Title>
					<T id="help" />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				{error ? <ErrorAlert>{error}</ErrorAlert> : null}
				{markdownText === null && !error ? <Loading noLogo /> : null}
				{markdownText !== null ? (
					<div className="prose">
						<Markdown options={{ disableParsingRawHTML: true }}>{markdownText}</Markdown>
					</div>
				) : null}
			</AppModal.Body>
		</AppModal>
	);
});

export { showHelpModal };
