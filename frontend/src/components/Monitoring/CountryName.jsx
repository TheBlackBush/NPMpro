import { IconWorld } from "@tabler/icons-react";
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
		<span className="d-inline-flex align-items-center gap-2 text-truncate">
			{isCountryCode(code) ? (
				<Flag countryCode={code.toUpperCase()} className="flex-shrink-0" />
			) : (
				<IconWorld className="icon text-secondary flex-shrink-0" width={20} aria-hidden="true" />
			)}
			<span className="text-truncate">{countryLabel(code)}</span>
		</span>
	);
}

export { CountryName, countryLabel };
