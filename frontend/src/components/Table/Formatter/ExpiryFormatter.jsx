import { StatusBadge } from "src/components/StatusBadge";
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
			<StatusBadge tone="warning" title={formatDateTime(value)}>
				<T id="expiry.in-days" data={{ days }} />
			</StatusBadge>
		);
	}
	return (
		<StatusBadge tone="destructive" title={formatDateTime(value)}>
			<T id="expiry.expired" />
		</StatusBadge>
	);
}
