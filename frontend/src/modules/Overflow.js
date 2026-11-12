// Whether a one-line text is cut: pure, so it is tested without a browser.

/**
 * Whether an element's content is wider than its box (a one-line text cut with an ellipsis).
 *
 * @param {{ scrollWidth: number, clientWidth: number } | null | undefined} element
 * @returns {boolean}
 */
const isCut = (element) => Boolean(element) && element.scrollWidth > element.clientWidth;

export { isCut };
