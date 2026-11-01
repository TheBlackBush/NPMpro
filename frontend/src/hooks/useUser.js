import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createUser, getUser, updateUser } from "src/api/backend";
import { hasPermission, isAdmin, MANAGE } from "src/modules/Permissions";

const fetchUser = (id) => {
	if (id === "new") {
		return Promise.resolve({
			id: 0,
			createdOn: "",
			modifiedOn: "",
			isDisabled: false,
			email: "",
			name: "",
			roles: [],
			avatar: "",
		});
	}
	return getUser(id, ["permissions"]);
};

const useUser = (id) => {
	return useQuery({
		queryKey: ["user", id],
		queryFn: () => fetchUser(id),
		staleTime: 60 * 1000, // 1 minute
	});
};

/**
 * Whether the signed-in user is an administrator; undefined while the user is loading
 */
const useIsAdmin = () => {
	const { data, isError } = useUser("me");
	if (isError) return false;
	return data ? isAdmin(data.roles) === true : undefined;
};

/**
 * Whether the signed-in user may manage a section (create, change, delete); false while the user is loading or its
 * read failed, as HasPermission hides the Save buttons then
 *
 * @param   {string} section  Permissions.js PROXY_HOSTS, ...
 * @returns {boolean}
 */
const useCanManage = (section) => {
	const { data } = useUser("me");
	return hasPermission(section, MANAGE, data?.permissions, data?.roles);
};

const useSetUser = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (values) => (values.id ? updateUser(values) : createUser(values)),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["user"] }),
				queryClient.invalidateQueries({ queryKey: ["users"] }),
				queryClient.invalidateQueries({ queryKey: ["audit-logs"] }),
			]);
		},
	});
};

export { useCanManage, useIsAdmin, useSetUser, useUser };
