import { useState } from "react";
import { Alert } from "react-bootstrap";
import { intl, T } from "src/locale";
import { formatApiError } from "src/modules/ApiError";

const hasMessage = (id) => Boolean(intl.messages[id]);
const formatMessage = (id, values) => intl.formatMessage({ id }, values);

// Message of an API error with its command output (if any) behind a toggle, without an alert around it
function ApiErrorContent({ error }) {
	const [showDetails, setShowDetails] = useState(false);
	const { message, output } = formatApiError(error, hasMessage, formatMessage);

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
						<pre className="mt-2 mb-0" style={{ maxHeight: "20em", overflow: "auto" }}>
							{output}
						</pre>
					) : null}
				</>
			) : null}
		</>
	);
}

function ErrorAlert({ error, onClose, className }) {
	return (
		<Alert variant="danger" className={className} onClose={onClose} dismissible={Boolean(onClose)}>
			<ApiErrorContent error={error} />
		</Alert>
	);
}

export { ApiErrorContent, ErrorAlert };
