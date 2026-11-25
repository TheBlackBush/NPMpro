import { useQuery } from "@tanstack/react-query";
import { getHealth } from "src/api/backend";
import { EXPIRY_WARNING_DAYS } from "src/modules/Expiry";

const fetchHealth = () => getHealth();

const useHealth = () => {
	return useQuery({
		queryKey: ["health"],
		queryFn: fetchHealth,
		refetchOnWindowFocus: false,
		retry: 5,
		refetchInterval: 15 * 1000, // 15 seconds
		staleTime: 14 * 1000, // 14 seconds
	});
};

// the days before expiry a certificate shows as expiring soon (the runtime setting), 14 while the health is unknown
const useWarningDays = () => useHealth().data?.certWarningDays ?? EXPIRY_WARNING_DAYS;

export { useHealth, useWarningDays };
