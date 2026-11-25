import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import {
	adoptHostDnsRecord,
	checkHostDns,
	deleteDnsChallenges,
	getDeadHost,
	getDnsChallenges,
	getHostDnsChecks,
	getProxyHost,
	getRedirectionHost,
	leaveHostDnsRecord,
	probeHostReach,
	removeHostDnsRecordAtProvider,
	testDnsCredential,
} from "src/api/backend";
import { mergeChecks } from "src/modules/DnsCheck";
import { pollDelay } from "src/modules/HostDnsRecords";
import { dnsRecordInvalidations, HOST_TYPES } from "src/modules/HostTypes";

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

const HOST_GETTERS = { proxy: getProxyHost, redirection: getRedirectionHost, dead: getDeadHost };

// the saved host with its DNS record states (npmproDnsRecords; the host's own query, so a save and the actions refresh it): while a name is
// pending the job still runs after the save, so the states are read again every few seconds, at most 10 times
const useHostDnsRecords = (type, hostId) => {
	const attempts = useRef(0);
	return useQuery({
		queryKey: [HOST_TYPES[type].itemKey, hostId],
		queryFn: () => HOST_GETTERS[type](hostId),
		staleTime: 60 * 1000,
		enabled: Boolean(hostId),
		refetchInterval: (query) => {
			const delay = pollDelay(query.state.data?.npmproDnsRecords, attempts.current);
			attempts.current = delay === false ? 0 : attempts.current + 1;
			return delay;
		},
	});
};

// the reach probe reads and writes nothing that lasts (a token file the server removes again)
const useProbeHostReach = () => useMutation({ mutationFn: (options) => probeHostReach(options) });

// Adopt and update, Leave alone, Delete at the provider again: the action of a host name's record row
const RECORD_ACTIONS = {
	adopt: adoptHostDnsRecord,
	leave: leaveHostDnsRecord,
	remove: removeHostDnsRecordAtProvider,
};

const useHostDnsRecordAction = (type, hostId) => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ action, id }) => RECORD_ACTIONS[action](id),
		onSettled: () =>
			Promise.all(
				dnsRecordInvalidations(type, hostId).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
			),
	});
};

export {
	useCheckHostDns,
	useDeleteDnsChallenges,
	useDnsChallenges,
	useHostDnsChecks,
	useHostDnsRecordAction,
	useHostDnsRecords,
	useProbeHostReach,
	useTestDnsCredential,
};
