const SHADES = 5;

/**
 * 0 for no data, 1 to 5 for a mapScale value (0..1) in five equal steps.
 */
const shadeIndex = (value) => (value > 0 ? Math.min(SHADES, Math.ceil(value * SHADES)) : 0);

/**
 * The count range of each shade 1 to 5, for the legend: the shades are log1p(count) / log1p(max) in five equal steps,
 * so the edges are turned back into counts. Returns [{ from, to }] (from at least 1, the last "to" is max); [] when max
 * is not above 0.
 */
const shadeRanges = (max) => {
	if (!(max > 0)) return [];
	const top = Math.log1p(max);
	const ranges = [];
	let previous = 0;
	for (let i = 1; i <= SHADES; i++) {
		const to = i === SHADES ? max : Math.max(1, Math.round(Math.expm1((i / SHADES) * top)));
		ranges.push({ from: Math.min(previous + 1, to), to });
		previous = to;
	}
	return ranges;
};

export { SHADES, shadeIndex, shadeRanges };
