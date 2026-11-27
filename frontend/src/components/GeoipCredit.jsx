import { cn } from "src/lib/utils";

// whole links at least 24 px tall (WCAG 2.5.8) without changing the text size
const LINK = "inline-flex min-h-6 items-center underline underline-offset-4 hover:text-foreground";

/**
 * The attribution the GeoIP database licences ask for, in the licences' own English wording (not translated):
 * DB-IP Lite is CC BY 4.0, MaxMind GeoLite2 asks for its notice. Nothing for another provider.
 *
 * @param {Object} props
 * @param {string} [props.provider]  "dbip" or "maxmind"
 * @param {string} [props.className]
 */
function GeoipCredit({ provider, className }) {
	if (provider === "dbip") {
		return (
			<p className={cn("text-muted-foreground text-xs", className)}>
				<a href="https://db-ip.com" target="_blank" rel="noopener noreferrer" className={LINK}>
					IP Geolocation by DB-IP
				</a>{" "}
				(
				<a
					href="https://creativecommons.org/licenses/by/4.0/"
					target="_blank"
					rel="noopener noreferrer"
					className={LINK}
				>
					CC BY 4.0
				</a>
				)
			</p>
		);
	}
	if (provider === "maxmind") {
		return (
			<p className={cn("text-muted-foreground text-xs", className)}>
				This product includes GeoLite Data created by MaxMind, available from{" "}
				<a href="https://www.maxmind.com" target="_blank" rel="noopener noreferrer" className={LINK}>
					https://www.maxmind.com
				</a>
				.
			</p>
		);
	}
	return null;
}

export { GeoipCredit };
