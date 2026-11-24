/**
 * A limiter: at most `max` of the wrapped tasks run at once, the others wait in order
 *
 * @param   {number}  max
 * @returns {Function}  (task) => Promise, the task's result; a failed task rejects its own promise only
 */
const limitConcurrency = (max) => {
	let active = 0;
	const waiting = [];

	const start = ({ task, resolve, reject }) => {
		active += 1;
		Promise.resolve()
			.then(task)
			.then(resolve, reject)
			.finally(() => {
				active -= 1;
				next();
			});
	};

	function next() {
		while (active < max && waiting.length > 0) start(waiting.shift());
	}

	return (task) =>
		new Promise((resolve, reject) => {
			waiting.push({ task, resolve, reject });
			next();
		});
};

export { limitConcurrency };
