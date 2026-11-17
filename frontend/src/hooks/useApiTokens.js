import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createApiToken,
	getApiTokens,
	getMcpTools,
	getOwnApiTokens,
	revokeApiToken,
	revokeOwnApiToken,
} from "src/api/backend";

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
 * The MCP tools and what each needs; administrators only
 */
const useMcpTools = () =>
	useQuery({
		queryKey: ["mcp-tools"],
		queryFn: () => getMcpTools(),
		staleTime: 60 * 1000,
	});

/**
 * Variables: the token form payload; resolves with the token and its text, shown once
 */
const useCreateApiToken = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (data) => createApiToken(data),
		onSuccess: () => invalidateAll(queryClient),
		// gcTime 0: the result holds the token text, so it leaves the mutation cache as soon as the window is gone
		gcTime: 0,
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

export { useAllApiTokens, useCreateApiToken, useMcpTools, useOwnApiTokens, useRevokeApiToken };
