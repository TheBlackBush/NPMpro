import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createDnsDomains, getDnsDomains, updateDnsDomain } from "src/api/backend";

// a save of domains changes the credentials' Domains column, the window of a credential and the picker
const DOMAIN_KEYS = [
	["dns-domains"],
	["dns-credentials"],
	["dns-credential"],
	["dns-domain-suggestions"],
	["audit-logs"],
];

const useDnsDomains = (expand) =>
	useQuery({ queryKey: ["dns-domains", expand], queryFn: () => getDnsDomains(expand), staleTime: 60 * 1000 });

const useDomainMutation = (mutationFn) => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onSuccess: () => Promise.all(DOMAIN_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
	});
};

const useCreateDnsDomains = () => useDomainMutation(createDnsDomains);
const useMoveDnsDomain = () => useDomainMutation(updateDnsDomain);

export { DOMAIN_KEYS, useCreateDnsDomains, useDnsDomains, useMoveDnsDomain };
