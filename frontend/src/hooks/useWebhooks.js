import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createWebhook, getWebhooks, testWebhook, updateWebhook } from "src/api/backend";

// the lists a change of a webhook touches: the list itself, the audit log (every change writes an entry) and the
// health report (a webhook turned off by NPMpro shows there)
const INVALIDATIONS = [["webhooks"], ["audit-logs"], ["health"]];

const invalidateAll = (queryClient) =>
	Promise.all(INVALIDATIONS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));

const useWebhooks = (options = {}) =>
	useQuery({
		queryKey: ["webhooks"],
		queryFn: () => getWebhooks(),
		staleTime: 10 * 1000,
		...options,
	});

/**
 * Variables: { id?, ...data }; creates without an id, else updates. A create, and the save of a webhook restored
 * without its secrets, answer the signing secret once.
 */
const useSaveWebhook = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, ...data }) => (id ? updateWebhook(id, data) : createWebhook(data)),
		onSuccess: () => invalidateAll(queryClient),
	});
};

// Variables: the webhook id; the answer is the outcome of the test delivery. A test is a delivery, so it can change
// the webhook's last delivery
const useTestWebhook = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id) => testWebhook(id),
		onSettled: () => invalidateAll(queryClient),
	});
};

export { INVALIDATIONS as WEBHOOK_INVALIDATIONS, useSaveWebhook, useTestWebhook, useWebhooks };
