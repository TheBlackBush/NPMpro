// The metadata section starts after the last "\xAB\xCD\xEFMaxMind.com"; its map holds the key "database_type"
// (a UTF-8 string, type 2) followed by its value string. Only the value is re-encoded; nothing after the metadata.
const MARKER = Buffer.concat([Buffer.from([0xab, 0xcd, 0xef]), Buffer.from("MaxMind.com")]);

const STRING_TYPE = 0x40; // control byte: the type (string = 2) in the top 3 bits, the size in the low 5

const encodeString = (text) => {
	const bytes = Buffer.from(text, "utf8");
	if (bytes.length < 29) return Buffer.concat([Buffer.from([STRING_TYPE + bytes.length]), bytes]);
	if (bytes.length < 285) return Buffer.concat([Buffer.from([STRING_TYPE + 29, bytes.length - 29]), bytes]);
	throw new Error("database type too long");
};

const KEY = encodeString("database_type");

/**
 * Rewrites the database_type of an MMDB file (turns a MaxMind test fixture into a file of another provider)
 *
 * @param   {Buffer}  buffer
 * @param   {string}  type
 * @returns {Buffer}
 */
const withDatabaseType = (buffer, type) => {
	const start = buffer.lastIndexOf(MARKER);
	if (start < 0) throw new Error("no MMDB metadata marker");
	const at = buffer.indexOf(KEY, start);
	if (at < 0) throw new Error("no database_type key in the metadata");
	const valueAt = at + KEY.length;
	const control = buffer[valueAt];
	if (Math.floor(control / 32) !== 2) throw new Error("database_type is not a plain string");
	let size = control % 32;
	let header = 1;
	if (size === 29) {
		size = 29 + buffer[valueAt + 1];
		header = 2;
	} else if (size > 29) throw new Error("unexpected string size");
	return Buffer.concat([buffer.subarray(0, valueAt), encodeString(type), buffer.subarray(valueAt + header + size)]);
};

export { withDatabaseType };
