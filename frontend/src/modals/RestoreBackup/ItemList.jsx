import { T } from "src/locale";

/**
 * A titled list of notes ("References that are cleared", "Needs secrets filled in"), left out when empty.
 *
 * @param {Object}  props
 * @param {string}  props.titleId    the title, with the {count} of items
 * @param {Array}   props.items      [{ key, text }]
 * @param {string}  [props.className]
 */
function ItemList({ titleId, items, className = "mb-3" }) {
	if (items.length === 0) return null;
	return (
		<div className={className}>
			<div className="mb-1 text-sm font-bold">
				<T id={titleId} data={{ count: items.length }} />
			</div>
			{/* a long list scrolls instead of stretching the dialog */}
			<ul className="mb-0 max-h-64 list-disc overflow-auto rounded-lg border py-2 pr-3 pl-8 text-sm">
				{items.map((item) => (
					<li key={item.key} className="break-words">
						{item.text}
					</li>
				))}
			</ul>
		</div>
	);
}

export { ItemList };
