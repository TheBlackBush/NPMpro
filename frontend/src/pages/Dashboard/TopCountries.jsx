import { Flag } from "src/components";
import { countryLabel } from "src/components/Monitoring/CountryName";
import { TruncatedText } from "src/components/TruncatedText";
import { formatCount } from "src/modules/Monitoring";

/**
 * The countries after the busiest one in the "Top countries today" card, in two columns: flag, country name (cut,
 * with its whole name in a tooltip only then) and the request count. Inside the card's link, so the name's tooltip
 * opens on hover and focus only.
 *
 * @param {object} props
 * @param {Array<{code: string, requests: number}>} props.rows  from topCountryRows, without the first
 */
function TopCountries({ rows }) {
	return (
		<ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-1.5 p-0 text-xs text-muted-foreground">
			{rows.map((row) => (
				<li key={row.code} className="flex min-w-0 items-center gap-1.5">
					<Flag countryCode={row.code} className="shrink-0" tooltip={false} />
					<TruncatedText className="flex-1" tap={false} hoverable={false}>
						{countryLabel(row.code)}
					</TruncatedText>
					<span className="shrink-0 font-semibold text-foreground tabular-nums">
						{formatCount(row.requests)}
					</span>
				</li>
			))}
		</ul>
	);
}

export { TopCountries };
