import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createUser, getUser, updateUser } from "src/api/backend";
import { isAdmin } from "src/modules/Permissions";

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
	const { data } = useUser("me");
	return data ? isAdmin(data.roles) === true : undefined;
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

export { useIsAdmin, useSetUser, useUser };
