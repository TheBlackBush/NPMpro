import { useEffect, useState } from "react";

// Seconds since `running` became true, 0 while not running.
export function useElapsed(running) {
	const [elapsed, setElapsed] = useState(0);

	useEffect(() => {
		if (!running) {
			setElapsed(0);
			return;
		}
		const start = Date.now();
		setElapsed(0);
		const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
		return () => clearInterval(id);
	}, [running]);

	return running ? elapsed : 0;
}
