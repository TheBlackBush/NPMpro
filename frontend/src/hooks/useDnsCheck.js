import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { checkHostDns, getHostDnsChecks, testDnsCredential } from "src/api/backend";
import { mergeChecks } from "src/modules/DnsCheck";

// a test reads at the provider and stores nothing: no query key changes
const useTestDnsCredential = () => useMutation({ mutationFn: (id) => testDnsCredential(id) });

// the cached host checks of the server (kept in memory there): the lists and the host windows read them
const HOST_CHECKS_KEY = ["dns-check-hosts"];

const useHostDnsChecks = ({ enabled = true } = {}) =>
	useQuery({
		queryKey: HOST_CHECKS_KEY,
		queryFn: getHostDnsChecks,
		staleTime: 30 * 1000,
		retry: false,
		enabled,
	});

// a check answers the fresh results of its hosts: they replace the cached ones of the same hosts
const useCheckHostDns = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (hosts) => checkHostDns(hosts),
		onSuccess: (fresh) => {
			queryClient.setQueryData(HOST_CHECKS_KEY, (cached) => mergeChecks(cached, fresh));
		},
	});
};

export { useCheckHostDns, useHostDnsChecks, useTestDnsCredential };
