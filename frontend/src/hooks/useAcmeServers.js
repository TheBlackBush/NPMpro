import { useQuery } from "@tanstack/react-query";
import { getAcmeServers } from "src/api/backend";

// the CAs a certificate can be requested at (the instance CA first); a failed read hides the select
const useAcmeServers = () =>
	useQuery({
		queryKey: ["acme-servers"],
		queryFn: () => getAcmeServers(),
		staleTime: 60 * 1000,
		retry: false,
	});

export { useAcmeServers };
