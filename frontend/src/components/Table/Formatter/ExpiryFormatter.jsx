import { formatDateTime, T } from "src/locale";
import { expiryInfo } from "src/modules/Expiry";

export function ExpiryFormatter({ value, provider }) {
	if (!value) return null;
	const { state, days } = expiryInfo(value);
	if (provider === "mtls" || state === "ok") {
		return <span>{formatDateTime(value)}</span>;
	}
	if (state === "soon") {
		return (
			<span className="badge bg-orange-lt" title={formatDateTime(value)}>
				<T id="expiry.in-days" data={{ days }} />
			</span>
		);
	}
	return (
		<span className="badge bg-red-lt" title={formatDateTime(value)}>
			<T id="expiry.expired" />
		</span>
	);
}
