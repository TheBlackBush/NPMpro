import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiToken, getApiTokens, getOwnApiTokens, revokeApiToken, revokeOwnApiToken } from "src/api/backend";

// a token change is audited
const INVALIDATED = [["api-tokens"], ["audit-logs"]];

const invalidateAll = (queryClient) =>
	Promise.all(INVALIDATED.map((queryKey) => queryClient.invalidateQueries({ queryKey })));

/**
 * The signed-in user's own tokens
 */
const useOwnApiTokens = (enabled = true) =>
	useQuery({
		queryKey: ["api-tokens", "own"],
		queryFn: () => getOwnApiTokens(),
		staleTime: 10 * 1000,
		enabled,
	});

/**
 * Every user's tokens; administrators only
 */
const useAllApiTokens = (enabled = true) =>
	useQuery({
		queryKey: ["api-tokens", "all"],
		queryFn: () => getApiTokens(),
		staleTime: 10 * 1000,
		enabled,
	});

/**
 * Variables: the token form payload; resolves with the token and its text, shown once
 */
const useCreateApiToken = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (data) => createApiToken(data),
		onSuccess: () => invalidateAll(queryClient),
	});
};

/**
 * Variables: the token id; `admin` revokes through the all-users route
 */
const useRevokeApiToken = ({ admin = false } = {}) => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id) => (admin ? revokeApiToken(id) : revokeOwnApiToken(id)),
		onSuccess: () => invalidateAll(queryClient),
	});
};

export { useAllApiTokens, useCreateApiToken, useOwnApiTokens, useRevokeApiToken };
