import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	checkHostDns,
	deleteDnsChallenges,
	getDnsChallenges,
	getHostDnsChecks,
	testDnsCredential,
} from "src/api/backend";
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

// the leftover challenge records are read at the provider on every open (no cache between openings) and after a
// delete, never on its own: a list read again while the user ticks or confirms could change what a tick means
const challengesKey = (id) => ["dns-challenges", id];

const useDnsChallenges = (id) =>
	useQuery({
		queryKey: challengesKey(id),
		queryFn: () => getDnsChallenges(id),
		staleTime: 0,
		gcTime: 0,
		retry: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

// a delete changes the provider's list: the window lists again
const useDeleteDnsChallenges = (id) => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (items) => deleteDnsChallenges(id, items),
		onSettled: () => queryClient.invalidateQueries({ queryKey: challengesKey(id) }),
	});
};

export { useCheckHostDns, useDeleteDnsChallenges, useDnsChallenges, useHostDnsChecks, useTestDnsCredential };
