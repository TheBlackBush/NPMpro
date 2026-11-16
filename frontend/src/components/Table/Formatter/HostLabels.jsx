import { TapTooltip } from "src/components/TapTooltip";
import { TruncatedText } from "src/components/TruncatedText";
import { Badge } from "src/components/ui/badge";
import { cn } from "src/lib/utils";
import { intl } from "src/locale";
import { tagToneClass } from "src/modules/TagTone";

// a tag in a row: a button that adds it to the list's Tags filter
function TagBadge({ tag, onTagClick }) {
	if (!onTagClick) {
		return (
			<Badge variant="outline" className={cn("h-5 font-normal", tagToneClass(tag))}>
				{tag}
			</Badge>
		);
	}
	const label = intl.formatMessage({ id: "list.filter.tag-add" }, { tag });
	return (
		<TapTooltip content={label} tap={false}>
			<Badge asChild variant="outline" className={cn("h-5 cursor-pointer font-normal", tagToneClass(tag))}>
				<button type="button" aria-label={label} onClick={() => onTagClick(tag)}>
					{tag}
				</button>
			</Badge>
		</TapTooltip>
	);
}

/**
 * The muted lines under a host's name in the lists and the phone cards: its description, cut to one line with the
 * whole text in a tooltip, then on their own line its tags as badges in the tone of their name (buttons when
 * onTagClick is given). Nothing for a host without either.
 *
 * The outer box has no width of its own (w-0) and fills its cell (min-w-full): in a table cell sized by its content,
 * the whole one-line text would otherwise set the cell's minimum width and push the other columns off screen instead
 * of being cut. The tags wrap inside it.
 */
export function HostLabels({ description, tags = [], onTagClick }) {
	const text = description?.trim() ?? "";
	if (text === "" && tags.length === 0) return null;
	return (
		<div className="mt-1 w-0 min-w-full">
			{text ? (
				<div className="flex min-w-0 text-muted-foreground">
					<TruncatedText className="max-w-full">{text}</TruncatedText>
				</div>
			) : null}
			{tags.length > 0 ? (
				<div className={cn("flex min-w-0 flex-wrap items-center gap-1", text ? "mt-1" : "")}>
					{tags.map((tag) => (
						<TagBadge key={tag} tag={tag} onTagClick={onTagClick} />
					))}
				</div>
			) : null}
		</div>
	);
}
