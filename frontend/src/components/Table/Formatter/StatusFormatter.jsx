import { StatusBadge } from "src/components/StatusBadge";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "src/components/ui/popover";
import { T } from "src/locale";

export function StatusFormatter({ enabled, nginxOnline, nginxErr }) {
	if (enabled && !nginxOnline) {
		return (
			<Popover>
				<PopoverTrigger asChild>
					<button type="button" className="rounded-4xl focus-visible:ring-[3px] focus-visible:ring-ring/50">
						<StatusBadge tone="destructive" className="cursor-pointer">
							<T id="status.config-error" />
						</StatusBadge>
					</button>
				</PopoverTrigger>
				<PopoverContent side="bottom" className="w-auto max-w-sm">
					<PopoverHeader>
						<PopoverTitle>
							<T id="notification.nginx-config-error" />
						</PopoverTitle>
					</PopoverHeader>
					<pre className="m-0 font-mono text-xs break-words whitespace-pre-wrap">
						{nginxErr || <T id="status.config-error.unknown" />}
					</pre>
				</PopoverContent>
			</Popover>
		);
	}

	return (
		<StatusBadge tone={enabled ? "success" : "warning"} pulse={enabled}>
			<T id={enabled ? "online" : "disabled"} />
		</StatusBadge>
	);
}
