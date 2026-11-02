import { CircleHelp } from "lucide-react";
import Markdown from "markdown-to-jsx";
import { useEffect, useState } from "react";
import { ErrorAlert, Loading } from "src/components";
import { Button } from "src/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "src/components/ui/sheet";
import { cn } from "src/lib/utils";
import { getHelpFile, intl, T } from "src/locale";
import EasyModal from "src/modules/easyModal";

const showHelpModal = (section) => {
	EasyModal.show(HelpModal, { section });
};

// The typography plugin's colours are mapped to the theme tokens, so the text follows light and dark without
// prose-invert.
const PROSE = cn(
	"prose prose-sm max-w-none",
	"[--tw-prose-body:var(--foreground)] [--tw-prose-headings:var(--foreground)] [--tw-prose-lead:var(--foreground)]",
	"[--tw-prose-links:var(--primary)] [--tw-prose-bold:var(--foreground)] [--tw-prose-counters:var(--muted-foreground)]",
	"[--tw-prose-bullets:var(--muted-foreground)] [--tw-prose-hr:var(--border)] [--tw-prose-quotes:var(--foreground)]",
	"[--tw-prose-quote-borders:var(--border)] [--tw-prose-captions:var(--muted-foreground)]",
	"[--tw-prose-code:var(--foreground)] [--tw-prose-pre-code:var(--foreground)] [--tw-prose-pre-bg:var(--muted)]",
	"[--tw-prose-th-borders:var(--border)] [--tw-prose-td-borders:var(--border)]",
	"prose-a:underline prose-code:before:content-none prose-code:after:content-none",
	"prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-pre:bg-muted",
	"prose-pre:[&_code]:bg-transparent prose-pre:[&_code]:p-0",
);

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
		<Sheet open={visible} onOpenChange={(open) => !open && remove()}>
			{/* No description: it would only repeat the title; undefined tells Radix it is left out on purpose */}
			<SheetContent
				side="right"
				className="w-full data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
				aria-describedby={undefined}
			>
				<SheetHeader className="border-b pr-12">
					<SheetTitle>
						<T id="help" />
					</SheetTitle>
				</SheetHeader>
				<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
					{error ? <ErrorAlert>{error}</ErrorAlert> : null}
					{markdownText === null && !error ? <Loading noLogo /> : null}
					{markdownText !== null ? (
						<div className={PROSE}>
							<Markdown options={{ disableParsingRawHTML: true }}>{markdownText}</Markdown>
						</div>
					) : null}
				</div>
			</SheetContent>
		</Sheet>
	);
});

/**
 * The "?" button that opens a help document in the help sheet (list page headers, Settings section headings). The
 * bolder stroke keeps the icon crisp in the small button.
 *
 * @param {Object} props
 * @param {string} props.doc          the help document (translations/help/<language>/<doc>.md)
 * @param {string} [props.className]
 */
function HelpButton({ doc, className }) {
	const label = intl.formatMessage({ id: "help" });
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			className={className}
			aria-label={label}
			title={label}
			onClick={() => showHelpModal(doc)}
		>
			<CircleHelp strokeWidth={2.25} aria-hidden="true" />
		</Button>
	);
}

export { HelpButton, showHelpModal };
