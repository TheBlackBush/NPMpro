import { CopyIcon } from "lucide-react";
import { useRef } from "react";
import { TapTooltip } from "src/components/TapTooltip";
import { Button } from "src/components/ui/button";
import { cn } from "src/lib/utils";
import { intl } from "src/locale";
import { codeBoxClass, codeWords } from "src/modules/CodeBox";
import { showSuccess } from "src/notifications";

/**
 * Read-only code (an address, a header, a command, a token, a JSON configuration) in a muted box with its Copy button
 * inside, top right. words: one line that wraps only between its words (a word longer than LONG_WORD may break);
 * scroll: the text keeps its lines and scrolls sideways (the box takes the focus so the keyboard can scroll it).
 * Copying writes the clipboard only; when the browser refuses, the text is selected for a manual copy.
 *
 * @param {Object} props
 * @param {string} props.text
 * @param {"words"|"scroll"} [props.wrap]
 * @param {string} [props.copiedMessage]  the toast, "Copied" by default
 * @param {Object} [props.copyProps]      more props of the copy button (a data attribute for the focus)
 * @param {string} [props.className]      of the box
 * A scroll box takes the focus: give it an aria-label (the name of its line) through the remaining props.
 */
function CodeBox({ text, wrap = "words", copiedMessage, copyProps, className, ...preProps }) {
	const pre = useRef(null);
	const classes = codeBoxClass(wrap);
	const name = intl.formatMessage({ id: "code-box.copy" });
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			showSuccess(copiedMessage ?? intl.formatMessage({ id: "code-box.copied" }));
		} catch {
			// no clipboard access (plain http, a browser setting or policy): select the text for a manual copy
			if (pre.current) window.getSelection()?.selectAllChildren(pre.current);
		}
	};
	return (
		<div className={cn(classes.box, className)}>
			{wrap === "scroll" ? (
				<pre
					// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region needs the focus for keyboard scrolling
					tabIndex={0}
					ref={pre}
					data-code-box=""
					{...preProps}
					className={classes.pre}
				>
					{text}
				</pre>
			) : (
				<pre ref={pre} data-code-box="" {...preProps} className={classes.pre}>
					{codeWords(text).map((piece) => (
						<span key={piece.key} className={classes.piece[piece.kind] || undefined}>
							{piece.text}
						</span>
					))}
				</pre>
			)}
			<TapTooltip content={name} tap={false}>
				<Button
					type="button"
					variant="outline"
					size="icon-sm"
					className={classes.copy}
					aria-label={name}
					onClick={copy}
					{...copyProps}
				>
					<CopyIcon aria-hidden="true" />
				</Button>
			</TapTooltip>
		</div>
	);
}

export { CodeBox };
