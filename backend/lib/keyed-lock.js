// One run at a time per key (an owner's DNS domains, a DDNS record): runs on the same key wait for each other, other
// keys run freely. A failed run frees its key. Keys compare as strings, so 3 and "3" are one key. Not re-entrant: a
// run that takes its own key again waits for itself forever.

const createKeyedLock = () => {
	const tails = new Map();
	return (key, fn) => {
		const name = String(key);
		const run = (tails.get(name) ?? Promise.resolve()).then(fn);
		const tail = run.catch(() => {});
		tails.set(name, tail);
		void tail.then(() => {
			if (tails.get(name) === tail) tails.delete(name);
		});
		return run;
	};
};

export { createKeyedLock };
