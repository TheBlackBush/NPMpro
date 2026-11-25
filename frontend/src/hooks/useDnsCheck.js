import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
	planHostDnsRecords,
	probeHostReach,
	removeHostDnsRecordAtProvider,
	testDnsCredential,
} from "src/api/backend";
import { mergeChecks } from "src/modules/DnsCheck";
import { createPoller } from "src/modules/HostDnsRecords";
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

const HOST_TYPE_IDS = { proxy: "proxy_host", redirection: "redirection_host", dead: "dead_host" };
const HOST_GETTERS = { proxy: getProxyHost, redirection: getRedirectionHost, dead: getDeadHost };

// the saved host with its DNS record states (npmproDnsRecords; the host's own query, so a save and the actions refresh it): while a name is
// pending the job still runs after the save, so the states are read again every few seconds, at most 10 times
const useHostDnsRecords = (type, hostId) => {
	const poller = useRef(null);
	poller.current ??= createPoller();
	return useQuery({
		queryKey: [HOST_TYPES[type].itemKey, hostId],
		queryFn: () => HOST_GETTERS[type](hostId),
		staleTime: 60 * 1000,
		enabled: Boolean(hostId),
		refetchInterval: (query) => poller.current(query.state.data?.npmproDnsRecords),
	});
};

const PLAN_DELAY_MS = 600;

// the plan of the names of a host window (what each can get at the provider and the public addresses): read when the
// option is switched on and again, after a pause in typing, when the names change; it writes nothing
const useHostDnsPlan = (type, hostId, names, enabled) => {
	const key = JSON.stringify(
		[...new Set(names.map((name) => name.toLowerCase()))].sort((a, b) => a.localeCompare(b)),
	);
	const [settled, setSettled] = useState(key);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(key), PLAN_DELAY_MS);
		return () => clearTimeout(timer);
	}, [key]);
	const list = JSON.parse(settled);
	return useQuery({
		queryKey: ["dns-plan", type, hostId ?? null, settled],
		queryFn: () => planHostDnsRecords({ hostType: HOST_TYPE_IDS[type], hostId, names: list }),
		enabled: enabled && list.length > 0,
		staleTime: 30 * 1000,
		retry: false,
		refetchOnWindowFocus: false,
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
	useHostDnsPlan,
	useHostDnsRecordAction,
	useHostDnsRecords,
	useProbeHostReach,
	useTestDnsCredential,
};
