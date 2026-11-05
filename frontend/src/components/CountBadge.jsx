import { Badge } from "src/components/ui/badge";
import { cn } from "src/lib/utils";
import { intl } from "src/locale";
import { sectionAccent } from "src/modules/SectionAccents";

/**
 * A muted badge with an item count: the number is shown, the full text ("6 items") is what screen readers read.
 *
 * @param {Object} props
 * @param {number} props.count
 * @param {string} [props.section]   a key of SECTIONS (SectionAccents.js): tints the badge in its accent colour, with a dot
 * @param {string} [props.className]
 */
function CountBadge({ count, section, className }) {
	const accent = sectionAccent(section);
	return (
		<Badge variant="secondary" className={cn(section && accent.bg, section && "text-foreground", className)}>
			{section ? (
				<span className={cn("size-1.5 rounded-full bg-current", accent.text)} aria-hidden="true" />
			) : null}
			<span aria-hidden="true">{count}</span>
			<span className="sr-only">{intl.formatMessage({ id: "list.count" }, { count })}</span>
		</Badge>
	);
}

export { CountBadge };
