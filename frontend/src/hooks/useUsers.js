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
 * The ids of the given users that have MFA on (the user list does not carry it). The keys start with "users", so the
 * list's invalidations refresh them too; an id is missing until its status is known.
 *
 * @param {Array<{ id: number }>} users
 * @returns {Set<number>}
 */
const useUsersMfa = (users) => {
	const results = useQueries({
		queries: (users ?? []).map((user) => ({
			queryKey: ["users", "mfa", user.id],
			queryFn: () => getMfaStatus(user.id),
			staleTime: 60 * 1000,
		})),
	});
	const ids = new Set();
	(users ?? []).forEach((user, index) => {
		if (results[index]?.data?.totpEnabled) ids.add(user.id);
	});
	return ids;
};

export { useUsers, useUsersMfa };
