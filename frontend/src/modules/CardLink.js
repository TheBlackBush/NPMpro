// The look of a clickable dashboard card, shared by the count tiles and the linked stat cards. Whole class strings so
// Tailwind finds them (the page CSP allows no runtime styles).

/**
 * The link around the card: the grid item (it stretches to the row's height), the keyboard focus ring, and the group
 * whose keyboard focus the card shows too.
 */
const CARD_LINK =
	"group block h-full min-w-0 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * The card in the link: on hover and keyboard focus it lifts 2 px (not with reduced motion), gets a soft shadow and
 * its ring turns to the primary colour; it fills the link, so cards of one row are as high as each other.
 */
const CARD_POP =
	"h-full transition-[translate,box-shadow] duration-150 hover:shadow-md hover:ring-primary/55 group-focus-visible:shadow-md group-focus-visible:ring-primary/55 motion-safe:hover:-translate-y-0.5 motion-safe:group-focus-visible:-translate-y-0.5";

export { CARD_LINK, CARD_POP };
