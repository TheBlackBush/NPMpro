// Layout of the flat world map: the Mercator fit.

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

export { fitMercator, mercatorLat, mercatorY };
