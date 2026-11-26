import { StatusBadge } from "src/components/StatusBadge";
import { TapTooltip } from "src/components/TapTooltip";
import { useWarningDays } from "src/hooks";
import { formatDateTime, T } from "src/locale";
import { expiryInfo } from "src/modules/Expiry";

export function ExpiryFormatter({ value, provider, validFrom }) {
	const warningDays = useWarningDays();
	if (!value) return null;
	const { state, days } = expiryInfo(value, { validFrom, days: warningDays });
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
