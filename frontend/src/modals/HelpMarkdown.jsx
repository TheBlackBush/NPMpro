import Markdown from "markdown-to-jsx";

// The help document's markdown, in a chunk of its own (loaded with the first help window)
export default function HelpMarkdown({ text }) {
	return <Markdown options={{ disableParsingRawHTML: true }}>{text}</Markdown>;
}
