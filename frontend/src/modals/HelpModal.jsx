import Markdown from "markdown-to-jsx";
import { AppModal } from "src/components";
import { getHelpFile, T } from "src/locale";
import EasyModal from "src/modules/easyModal";

const showHelpModal = (section) => {
	EasyModal.show(HelpModal, { section });
};

const HelpModal = EasyModal.create(({ section, visible, remove }) => {
	const markdownText = getHelpFile(section);

	return (
		<AppModal show={visible} onHide={remove}>
			<AppModal.Header closeButton>
				<AppModal.Title>
					<T id="help" />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<Markdown options={{ disableParsingRawHTML: true }}>{markdownText}</Markdown>
			</AppModal.Body>
		</AppModal>
	);
});

export { showHelpModal };
