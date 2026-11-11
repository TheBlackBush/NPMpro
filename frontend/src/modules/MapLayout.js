// Layout of the flat world map: the Mercator fit and where the hover tooltip sits.

// world-atlas 110m without Antarctica: Greenland's north coast and Tierra del Fuego
const NORTH = 83.65;
const SOUTH = -55.62;

const mercatorY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const mercatorLat = (y) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

/**
 * Scale, centre and height of a d3 geoMercator that fills the width (less the margin on both sides) with the world;
 * the height follows the projection.
 *
 * @param {number} width
 * @param {number} [margin]
 * @returns {{ scale: number, center: [number, number], height: number }}
 */
const fitMercator = (width, margin = 8, north = NORTH, south = SOUTH) => {
	const scale = (width - 2 * margin) / (2 * Math.PI);
	const top = mercatorY(north);
	const bottom = mercatorY(south);
	return {
		scale,
		center: [0, mercatorLat((top + bottom) / 2)],
		height: Math.ceil(scale * (top - bottom) + 2 * margin),
	};
};

// half the expected tooltip width, and the room it needs above the pointer
const TIP_HALF = 72;
const TIP_ABOVE = 44;

/**
 * Tooltip anchor inside the map box: centred on the pointer but kept inside the box, and below the pointer when there
 * is no room above it.
 *
 * @param {number} x      pointer x in the box
 * @param {number} y      pointer y in the box
 * @param {number} width  box width
 * @returns {{ left: number, top: number, below: boolean }}
 */
const tipPosition = (x, y, width) => ({
	left: Math.min(Math.max(x, TIP_HALF), Math.max(TIP_HALF, width - TIP_HALF)),
	top: y,
	below: y < TIP_ABOVE,
});

export { fitMercator, mercatorLat, mercatorY, tipPosition };
