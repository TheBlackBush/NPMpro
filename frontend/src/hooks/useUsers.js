import { useQueries, useQuery } from "@tanstack/react-query";
import { getMfaStatus, getUsers } from "src/api/backend";

const fetchUsers = (expand) => getUsers(expand);

const useUsers = (expand) =>
	useQuery({
		queryKey: ["users", { expand }],
		queryFn: () => fetchUsers(expand),
		staleTime: 60 * 1000,
	});

/**
 * The ids of the given users that have MFA on (the user list does not carry it), the current user excluded. The keys
 * are outside the "users" prefix, so a list invalidation does not refetch them; after a reset invalidate
 * ["users-mfa", id]. An id is missing until its status is known.
 *
 * @param {Array<{ id: number }>} users
 * @param {number} [currentUserId]
 * @returns {Set<number>}
 */
const useUsersMfa = (users, currentUserId) => {
	// the own row has no Reset MFA item
	const others = (users ?? []).filter((user) => user.id !== currentUserId);
	const results = useQueries({
		queries: others.map((user) => ({
			queryKey: ["users-mfa", user.id],
			queryFn: () => getMfaStatus(user.id),
			staleTime: 60 * 1000,
			// a failed request counts against the /users rate limiter
			retry: false,
		})),
	});
	const ids = new Set();
	others.forEach((user, index) => {
		if (results[index]?.data?.totpEnabled) ids.add(user.id);
	});
	return ids;
};

export { useUsers, useUsersMfa };
