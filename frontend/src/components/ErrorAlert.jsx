import { IconAlertCircle } from "@tabler/icons-react";
import { useState } from "react";
import { Alert } from "react-bootstrap";
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
			<span className="text-break">{message}</span>
			{output ? (
				<>
					<div>
						<button
							type="button"
							className="btn btn-link p-0 text-reset"
							aria-expanded={showDetails}
							onClick={() => setShowDetails(!showDetails)}
						>
							<T id={showDetails ? "error.details.hide" : "error.details.show"} />
						</button>
					</div>
					{showDetails ? (
						<pre className="mt-2 mb-0 overflow-auto text-wrap text-break" style={{ maxHeight: "20em" }}>
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
		<Alert variant="danger" className={className} onClose={onClose} dismissible={Boolean(onClose)}>
			<div className="alert-icon">
				<IconAlertCircle className="icon" aria-hidden="true" />
			</div>
			<div className="text-break">{children ?? <ApiErrorContent error={error} />}</div>
		</Alert>
	);
}

export { ApiErrorContent, ErrorAlert };
