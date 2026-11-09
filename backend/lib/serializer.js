/**
 * Runs functions one after another per key, also when an earlier one failed. Without a key all share one queue.
 *
 * @returns {(fn: Function, key?: *) => Promise}  rejects with fn's own error; size() counts the open keys
 */
const createSerializer = () => {
	const tails = new Map();
	const serialize = (fn, key) => {
		const run = (tails.get(key) ?? Promise.resolve()).then(() => fn());
		const settled = run.then(
			() => {},
			() => {},
		);
		tails.set(key, settled);
		settled.then(() => {
			if (tails.get(key) === settled) tails.delete(key);
		});
		return run;
	};
	serialize.size = () => tails.size;
	return serialize;
};

export { createSerializer };
