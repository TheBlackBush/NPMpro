export const formatElapsed = (totalSeconds) => {
	const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
