import Markdown from "markdown-to-jsx";
import { cn } from "src/lib/utils";

const OPTIONS = {
	disableParsingRawHTML: true,
	forceInline: false,
	overrides: {
		a: { props: { target: "_blank", rel: "noopener noreferrer" } },
		code: { props: { className: "rounded bg-muted px-1.5 font-mono text-[12.5px]" } },
	},
};

/** Markdown from the schema (group intros, route texts, field descriptions), as React elements and never as HTML */
export function InlineMarkdown({ text, className }) {
	return (
		<div className={cn("[&_p]:m-0 [&_p+p]:mt-2 [&_ul]:my-1 [&_ul]:ps-5", className)}>
			<Markdown options={OPTIONS}>{text}</Markdown>
		</div>
	);
}
