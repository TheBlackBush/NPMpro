import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createDnsDomains, getDnsDomains, getProviderDomains, updateDnsDomain } from "src/api/backend";

// a save of domains changes the credentials' Domains column, the window of a credential and the picker
const DOMAIN_KEYS = [
	["dns-domains"],
	["dns-credentials"],
	["dns-credential"],
	["dns-domain-suggestions"],
	["audit-logs"],
];

const useDnsDomains = (expand, options = {}) =>
	useQuery({
		queryKey: ["dns-domains", expand],
		queryFn: () => getDnsDomains(expand),
		staleTime: 60 * 1000,
		...options,
	});

// the zones a credential's provider lists, asked on each open of the Add domains window and never kept
const useProviderDomains = (id) =>
	useQuery({
		queryKey: ["dns-provider-domains", id],
		// the query's signal: a cancelled query (the window closed) aborts the request
		queryFn: ({ signal }) => getProviderDomains(id, signal),
		enabled: id !== undefined && id !== null,
		retry: false,
		staleTime: 0,
		gcTime: 0,
		// a refocus must not call the provider again or swap the shown list
		refetchOnWindowFocus: false,
	});

const useDomainMutation = (mutationFn) => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onSuccess: () => Promise.all(DOMAIN_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
	});
};

const useCreateDnsDomains = () => useDomainMutation(createDnsDomains);
const useMoveDnsDomain = () => useDomainMutation(updateDnsDomain);

export { DOMAIN_KEYS, useCreateDnsDomains, useDnsDomains, useMoveDnsDomain, useProviderDomains };
