import { lazy, Suspense } from "react";
import { Loading } from "src/components";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "src/components/ui/sheet";
import { cn } from "src/lib/utils";
import { T } from "src/locale";

const HelpMarkdown = lazy(() => import("src/modals/HelpMarkdown"));

// the same prose colours as the help window, mapped to the theme tokens
export const PROSE = cn(
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

/** Markdown text (the guide, a group intro, a description) in the help window's prose style */
export function Prose({ text, className }) {
	return (
		<Suspense fallback={null}>
			<div className={cn(PROSE, className)}>
				<HelpMarkdown text={text} />
			</div>
		</Suspense>
	);
}

/** The full guide (the schema's description, markdown) in a right sheet */
export function GuideSheet({ open, onOpenChange, text }) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className="w-full data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
				aria-describedby={undefined}
			>
				<SheetHeader className="border-b pr-12">
					<SheetTitle>
						<T id="api-reference.full-guide" />
					</SheetTitle>
				</SheetHeader>
				<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
					<Suspense fallback={<Loading noLogo />}>
						<Prose text={text} />
					</Suspense>
				</div>
			</SheetContent>
		</Sheet>
	);
}
