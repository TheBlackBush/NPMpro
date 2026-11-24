/** A failure the engine itself reports (not a provider answer); key and values travel in the record's meta */
class EngineFailure extends Error {
	constructor(message, key, values) {
		super(message);
		this.key = key;
		this.values = values;
	}
}

export { EngineFailure };
