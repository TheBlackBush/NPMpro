import { GlobeIcon } from "lucide-react";
import { Flag } from "src/components";
import { currentLocale, intl } from "src/locale";
import { countryName, isCountryCode } from "src/modules/Monitoring";

/**
 * Country name in the app locale, "Unknown" for "--", null or anything that is not a two-letter code.
 */
const countryLabel = (code) =>
	isCountryCode(code) ? countryName(code, currentLocale) : intl.formatMessage({ id: "unknown" });

/**
 * Flag and country name; a world icon and "Unknown" when the code is not a country.
 *
 * @param {object} props
 * @param {string|null} props.code two-letter country code
 */
function CountryName({ code }) {
	return (
		<span className="inline-flex max-w-full items-center gap-2" title={countryLabel(code)}>
			{isCountryCode(code) ? (
				<Flag countryCode={code.toUpperCase()} className="shrink-0" />
			) : (
				<GlobeIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
			)}
			<span className="truncate">{countryLabel(code)}</span>
		</span>
	);
}

export { CountryName, countryLabel };
