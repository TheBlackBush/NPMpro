import { StatusBadge } from "src/components/StatusBadge";
import { Badge } from "src/components/ui/badge";
import { formatDateTime, T } from "src/locale";
import { BreakableHost } from "./BreakableHost";

const DomainLink = ({ domain, color }) => {
	// when domain contains a wildcard, make the link go nowhere.
	let onClick;
	if (domain.includes("*")) {
		onClick = (e) => e.preventDefault();
	}
	return (
		// a long name wraps at its dots inside the badge instead of pushing the row menu off a phone screen;
		// the old per-badge colour name now only chooses between the filled and the outline look
		<Badge
			asChild
			variant={color ? "secondary" : "outline"}
			className="mr-2 h-auto min-h-6 min-w-0 max-w-full rounded-xl px-2.5 py-0.5 text-left font-mono whitespace-normal"
		>
			<a href={`http://${domain}`} target="_blank" rel="noopener" onClick={onClick}>
				<span>
					<BreakableHost value={domain} />
				</span>
			</a>
		</Badge>
	);
};

export function DomainsFormatter({ domains, createdOn, niceName, provider, color }) {
	const elms = [];

	if (domains.length === 0 && !niceName) {
		elms.push(
			<StatusBadge key="nice-name" tone="destructive" dot={false} className="mr-2">
				<T id="unknown" />
			</StatusBadge>,
		);
	}
	if (niceName && provider !== "letsencrypt") {
		elms.push(
			// a long name wraps between words, like the domain badges, so the row menu stays on a phone screen
			<Badge key="nice-name" variant="secondary" className="mr-2 h-auto py-0.5 text-left whitespace-normal">
				{niceName}
			</Badge>,
		);
	}

	elms.push(...domains.map((domain) => <DomainLink key={domain} domain={domain} color={color} />));

	return (
		<div className="flex-1">
			<div className="flex flex-wrap items-center gap-y-1 font-medium">{...elms}</div>
			<div className="mt-1 text-muted-foreground">
				<T id="created-on" data={{ date: formatDateTime(createdOn) }} />
			</div>
		</div>
	);
}
