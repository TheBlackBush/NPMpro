import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "src/components/ui/button";
import { cn } from "src/lib/utils";
import { intl } from "src/locale";
import { highlightJson, highlightShell } from "src/modules/ApiRequest";

const KIND_CLASS = {
	key: "text-code-key",
	string: "text-code-string",
	number: "text-code-number",
	comment: "text-code-comment",
};

/**
 * A code sample on the dark code surface with highlighting and a copy button. The block takes the focus so the
 * keyboard can scroll it.
 *
 * @param {Object} props
 * @param {string} props.text
 * @param {"json"|"shell"} props.language
 * @param {string} [props.className]
 */
export function CodeBlock({ text, language, className }) {
	const [copied, setCopied] = useState(false);
	const tokens = language === "json" ? highlightJson(text) : highlightShell(text);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// no clipboard access (a browser setting or policy): the text stays selectable in the block
		}
	};

	return (
		<div className={cn("group relative", className)}>
			<pre
				// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region needs the focus for keyboard scrolling
				tabIndex={0}
				className="m-0 overflow-auto rounded-lg border bg-code-bg p-4 pt-10 font-mono text-[12.5px] text-code-fg leading-relaxed"
			>
				<code>
					{tokens.map((token, index) => (
						<span key={index} className={KIND_CLASS[token.kind]}>
							{token.text}
						</span>
					))}
				</code>
			</pre>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="absolute top-2 right-2 text-code-fg hover:bg-white/10 hover:text-code-fg"
				aria-label={intl.formatMessage({ id: "api-reference.copy" })}
				title={intl.formatMessage({ id: copied ? "api-reference.copied" : "api-reference.copy" })}
				onClick={copy}
			>
				{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
			</Button>
		</div>
	);
}
