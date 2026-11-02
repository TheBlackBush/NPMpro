import { CircleAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Alert, AlertAction } from "src/components/ui/alert";
import { Button } from "src/components/ui/button";
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

function ErrorAlert({ error, children, onClose, className }) {
	if (!children && !error) return null;
	return (
		<Alert variant="destructive" className={className}>
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
