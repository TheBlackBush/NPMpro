import { StatusBadge } from "src/components/StatusBadge";
import { TapTooltip } from "src/components/TapTooltip";
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
			<TapTooltip content={formatDateTime(value)}>
				<StatusBadge tone="warning">
					<T id="expiry.in-days" data={{ days }} />
				</StatusBadge>
			</TapTooltip>
		);
	}
	return (
		<TapTooltip content={formatDateTime(value)}>
			<StatusBadge tone="destructive">
				<T id="expiry.expired" />
			</StatusBadge>
		</TapTooltip>
	);
}
