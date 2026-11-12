import { Flag } from "src/components";
import { countryLabel } from "src/components/Monitoring/CountryName";
import { TruncatedText } from "src/components/TruncatedText";
import { formatCount } from "src/modules/Monitoring";

/**
 * The rows of the "Top countries today" card: flag, country name (cut, with its whole name in a tooltip only then)
 * and the request count. Inside the card's link, so the name's tooltip opens on hover and focus only.
 *
 * @param {object} props
 * @param {Array<{code: string, requests: number}>} props.rows  from topCountryRows
 */
function TopCountries({ rows }) {
	return (
		<ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0 text-sm">
			{rows.map((row) => (
				<li key={row.code} className="flex min-w-0 items-center gap-2">
					<Flag countryCode={row.code} className="shrink-0" tooltip={false} />
					<TruncatedText className="flex-1" tap={false}>
						{countryLabel(row.code)}
					</TruncatedText>
					<span className="ml-auto shrink-0 font-semibold tabular-nums">{formatCount(row.requests)}</span>
				</li>
			))}
		</ul>
	);
}

export { TopCountries };
