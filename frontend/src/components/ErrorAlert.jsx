import { CircleAlertIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertAction } from "src/components/ui/alert";
import { Button } from "src/components/ui/button";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { formatApiError } from "src/modules/ApiError";

const hasMessage = (id) => Boolean(intl.messages[id]);
const formatMessage = (id, values) => intl.formatMessage({ id }, values);

// Message of an API error with its command output (if any) behind a toggle, without an alert around it
function ApiErrorContent({ error }) {
	const [showDetails, setShowDetails] = useState(false);
	const formatted = formatApiError(error, hasMessage, formatMessage);
	const message = typeof error === "string" ? error : formatted.message;
	const { output } = formatted;

	return (
		<>
			<span className="break-words">{message}</span>
			{output ? (
				<>
					<div>
						<Button
							type="button"
							variant="link"
							className="h-auto p-0 text-inherit"
							aria-expanded={showDetails}
							onClick={() => setShowDetails(!showDetails)}
						>
							<T id={showDetails ? "error.details.hide" : "error.details.show"} />
						</Button>
					</div>
					{showDetails ? (
						<pre className="mt-2 mb-0 max-h-80 overflow-auto font-mono text-xs break-words whitespace-pre-wrap">
							{output}
						</pre>
					) : null}
				</>
			) : null}
		</>
	);
}

/**
 * A red alert with an error (an API error through error, or any message as children), optionally closable. Inside a
 * window's body it scrolls into view and takes the focus when it appears or its message changes, so a refused save
 * is seen even with the body scrolled down (role alert still announces it). Changes of children that are elements
 * count only when the alert appears (an element written inline is new on every render).
 */
function ErrorAlert({ error, children, onClose, className }) {
	const ref = useRef(null);
	const shown = Boolean(children || error);
	const text = typeof children === "string" ? children : null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: error and text are the message, a new one is shown again
	useEffect(() => {
		const alert = ref.current;
		if (!(shown && alert?.closest("[data-window-body]"))) return;
		alert.scrollIntoView({ block: "nearest" });
		alert.focus({ preventScroll: true });
	}, [shown, error, text]);
	if (!shown) return null;
	return (
		<Alert ref={ref} tabIndex={-1} variant="destructive" className={cn("outline-none", className)}>
			<CircleAlertIcon aria-hidden="true" />
			<div className="break-words">{children ?? <ApiErrorContent error={error} />}</div>
			{onClose ? (
				<AlertAction>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label={intl.formatMessage({ id: "aria.close" })}
						onClick={onClose}
					>
						<XIcon aria-hidden="true" />
					</Button>
				</AlertAction>
			) : null}
		</Alert>
	);
}

export { ApiErrorContent, ErrorAlert };
