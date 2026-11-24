import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react";
import { TapTooltip } from "src/components/TapTooltip";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { acmeServerLabel } from "src/modules/AcmeAccount";
import { caaLines } from "src/modules/Caa";

const caText = (server) => {
	if (!server) return "";
	const { labelId, text } = acmeServerLabel(server);
	return labelId ? intl.formatMessage({ id: labelId }) : text;
};

/**
 * The small CAA warning after the names of an ACME certificate in the list: shown for a cached result of refused,
 * limited or unknown (Caa.js caaBadge). The tooltip has one line per name with that state.
 *
 * @param {Object} props
 * @param {{ state: string, tone: string, results: Array }} props.badge  caaBadge of the certificate's cached entry
 * @param {string}  [props.server]  the CA that issues the certificate (empty: the instance CA, named by `instanceServer`)
 * @param {string}  [props.instanceServer]
 */
export function CaaBadge({ badge, server, instanceServer }) {
	const ca = caText(server || instanceServer);
	const { lines, more } = caaLines(badge.results);
	const stateText = intl.formatMessage({ id: `certificates.caa.state.${badge.state}` });
	// the accessible name carries the lines of the tooltip, which a focused icon would not read
	const label = [
		intl.formatMessage({ id: "certificates.caa.badge-label" }, { state: stateText }),
		...lines.map(({ name, line }) =>
			[
				`${name}: ${intl.formatMessage({ id: line.messageId }, { ...line.values, ca })}`,
				line.reasonId ? intl.formatMessage({ id: line.reasonId }) : "",
			]
				.filter(Boolean)
				.join(" "),
		),
	].join(". ");
	const Icon = badge.state === "refused" ? CircleAlertIcon : TriangleAlertIcon;
	return (
		<TapTooltip
			content={
				<ul className="m-0 flex list-none flex-col gap-1 p-0 text-left">
					{lines.map(({ name, line }) => (
						<li key={name}>
							<span className="font-mono">{name}</span>:{" "}
							<T id={line.messageId} data={{ ...line.values, ca }} />
							{line.reasonId ? (
								<>
									{" "}
									<T id={line.reasonId} />
								</>
							) : null}
						</li>
					))}
					{more > 0 ? (
						<li>
							<T id="certificates.caa.more" data={{ count: more }} />
						</li>
					) : null}
					{lines.length === 0 ? (
						<li>
							<T id={`certificates.caa.state.${badge.state}`} />
						</li>
					) : null}
				</ul>
			}
		>
			<span
				data-caa={badge.state}
				role="img"
				aria-label={label}
				className={cn(
					"mr-2 inline-flex size-6 items-center justify-center rounded-full",
					badge.tone === "destructive" ? "text-destructive" : "text-warning",
				)}
			>
				<Icon className="size-4" aria-hidden="true" />
			</span>
		</TapTooltip>
	);
}
