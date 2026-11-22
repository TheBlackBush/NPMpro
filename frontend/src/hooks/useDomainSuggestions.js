import { useQuery } from "@tanstack/react-query";
import { getDnsDomainSuggestions } from "src/api/backend";

// The picker's suggestions (DNS domains and the names hosts and certificates use). Input help only: an error leaves
// the field without suggestions, typing still works.
const useDomainSuggestions = (options = {}) =>
	useQuery({
		queryKey: ["dns-domain-suggestions"],
		queryFn: getDnsDomainSuggestions,
		staleTime: 60 * 1000,
		retry: false,
		...options,
	});

export { useDomainSuggestions };
