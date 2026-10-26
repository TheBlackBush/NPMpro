const separatorPattern = /[-_\s]+(?<char>.)?/gu;
const upperBoundaryPattern = /(?=[A-Z])/u;

// rawKeys: names (as sent by the API or already converted) of maps whose own keys are data, not field names
// (for example counts keyed by type id); the keys inside such a map are kept as they are
const mapKeys = (fn) => {
	const walk = (o, { rawKeys = [] } = {}) => {
		if (Array.isArray(o)) return o.map((item) => walk(item, { rawKeys }));
		if (o && typeof o === "object" && o.constructor === Object) {
			return Object.fromEntries(
				Object.entries(o).map(([k, v]) => {
					const value = walk(v, { rawKeys });
					if (rawKeys.includes(k) && v && typeof v === "object" && !Array.isArray(v)) {
						return [
							fn(k),
							Object.fromEntries(Object.entries(v).map(([id, n]) => [id, walk(n, { rawKeys })])),
						];
					}
					return [fn(k), value];
				}),
			);
		}
		return o;
	};
	return walk;
};
export const camelizeKeys = mapKeys((s) => s.replace(separatorPattern, (_, c) => (c ? c.toUpperCase() : "")));
export const decamelizeKeys = mapKeys((s) => s.split(upperBoundaryPattern).join("_").toLowerCase());
