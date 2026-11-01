import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { getDeadHosts, getProxyHosts, getRedirectionHosts, getStreams } from "src/api/backend";
import { groupNames } from "src/modules/HostGroups";
import { DEAD_HOSTS, hasPermission, PROXY_HOSTS, REDIRECTION_HOSTS, STREAMS, VIEW } from "src/modules/Permissions";
import { useUser } from "./useUser";

const getDirectory = (item) => item?.npmproDirectory;

const useDirectorySuggestions = (items) =>
	useMemo(
		() => Array.from(new Set((items ?? []).map(getDirectory).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
		[items],
	);

// the lists of the four host types, with the query keys of useProxyHosts() and its siblings without expand. The list
// pages ask with expand (owner, certificate, ...), so their cache entries differ: only Monitoring > Traffic shares
// these. A later distinct-groups endpoint could replace the four requests
const HOST_LISTS = [
	{ key: "proxy-hosts", fetch: getProxyHosts, section: PROXY_HOSTS },
	{ key: "redirection-hosts", fetch: getRedirectionHosts, section: REDIRECTION_HOSTS },
	{ key: "dead-hosts", fetch: getDeadHosts, section: DEAD_HOSTS },
	{ key: "streams", fetch: getStreams, section: STREAMS },
];

// the lists' data, once per change of any of them (useQueries keeps a combine result while its input is the same)
const combineLists = (results) => results.map((result) => result.data);

/**
 * The groups already used by any host type, for the Group field of the host windows: a list the user may not view is
 * not fetched (and adds nothing), a list that fails to load adds nothing
 *
 * @returns {string[]}
 */
const useGroupSuggestions = () => {
	const { data: user } = useUser("me");
	const lists = useQueries({
		queries: HOST_LISTS.map(({ key, fetch, section }) => ({
			queryKey: [key, { expand: undefined }],
			queryFn: () => fetch(),
			staleTime: 60 * 1000,
			enabled: hasPermission(section, VIEW, user?.permissions, user?.roles),
		})),
		combine: combineLists,
	});
	return useMemo(() => groupNames(...lists), [lists]);
};

export { getDirectory, useDirectorySuggestions, useGroupSuggestions };
