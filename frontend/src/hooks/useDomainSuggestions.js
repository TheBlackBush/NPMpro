import { useQuery } from "@tanstack/react-query";
import { getDnsDomainSuggestions } from "src/api/backend";
import { CERTIFICATES, hasPermission, VIEW } from "src/modules/Permissions";
import { useUser } from "./useUser";

// The picker's suggestions (DNS domains and the names hosts and certificates use). Input help only: an error leaves
// the field without suggestions, typing still works. The route needs Certificates view, so the others never ask.
const useDomainSuggestions = ({ enabled = true, ...options } = {}) => {
	const { data: user } = useUser("me");
	return useQuery({
		queryKey: ["dns-domain-suggestions"],
		queryFn: getDnsDomainSuggestions,
		staleTime: 60 * 1000,
		retry: false,
		...options,
		enabled: enabled && hasPermission(CERTIFICATES, VIEW, user?.permissions, user?.roles),
	});
};

export { useDomainSuggestions };
