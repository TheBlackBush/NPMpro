const SHADES = 5;

/**
 * 0 for no data, 1 to 5 for a mapScale value (0..1) in five equal steps.
 */
const shadeIndex = (value) => (value > 0 ? Math.min(SHADES, Math.ceil(value * SHADES)) : 0);

/**
 * The count range of each shade, for the legend. A count's shade is ceil(5 * log1p(count) / log1p(max)) (mapScale
 * and shadeIndex), so the highest count of shade i is floor(expm1(i / 5 * log1p(max))); the small epsilon keeps an
 * edge that lands on a whole number. Shades no count reaches are left out, so no range repeats a value. Returns
 * [{ shade, from, to }] in order (the first from is 1, the last to is max); [] when max is not above 0.
 */
const shadeRanges = (max) => {
	if (!(max > 0)) return [];
	const top = Math.log1p(max);
	const ranges = [];
	let previous = 0;
	for (let shade = 1; shade <= SHADES; shade++) {
		const to = shade === SHADES ? max : Math.floor(Math.expm1((shade / SHADES) * top) + 1e-9);
		if (to > previous) {
			ranges.push({ shade, from: previous + 1, to });
			previous = to;
		}
	}
	return ranges;
};

export { SHADES, shadeIndex, shadeRanges };
