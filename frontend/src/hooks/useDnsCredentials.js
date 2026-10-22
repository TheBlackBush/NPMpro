import { useQuery } from "@tanstack/react-query";
import { getDnsCredentials } from "src/api/backend";

const useDnsCredentials = (expand) =>
	useQuery({
		queryKey: ["dns-credentials", expand],
		queryFn: () => getDnsCredentials(expand),
		staleTime: 60 * 1000,
	});

export { useDnsCredentials };
