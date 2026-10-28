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
			<div className="fw-bold mb-1">
				<T id={titleId} data={{ count: items.length }} />
			</div>
			{/* no utility gives a capped height: a long list scrolls instead of stretching the dialog */}
			<ul className="mb-0 overflow-auto" style={{ maxHeight: "12em" }}>
				{items.map((item) => (
					<li key={item.key} className="text-break">
						{item.text}
					</li>
				))}
			</ul>
		</div>
	);
}

export { ItemList };
