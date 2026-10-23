import { useEffect, useState } from "react";

/**
 * True once `ms` milliseconds have passed since the component mounted (immediately when `ms` is 0)
 *
 * @param   {number}  ms
 * @returns {boolean}
 */
const useDelayElapsed = (ms) => {
	const [elapsed, setElapsed] = useState(ms <= 0);
	useEffect(() => {
		if (ms <= 0) return;
		const timer = setTimeout(() => setElapsed(true), ms);
		return () => clearTimeout(timer);
	}, [ms]);
	return elapsed;
};

export { useDelayElapsed };
