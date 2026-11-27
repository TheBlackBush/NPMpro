import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createWebhook,
	getWebhookDeliveries,
	getWebhooks,
	redeliverWebhook,
	testWebhook,
	updateWebhook,
} from "src/api/backend";
import { refreshInterval, WATCH_MS } from "src/modules/WebhookDeliveries";

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
		// gcTime 0: the result holds the secret and the variables the typed URL, so they leave the mutation cache as soon
		// as the window is gone
		gcTime: 0,
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

// per webhook id, the time (ms) until which the deliveries window refreshes fast after a redeliver
const watchUntil = new Map();

/**
 * One page of the deliveries of a webhook, asked from the server (limit and offset; the total comes back in
 * X-Total-Count). The previous page stays on screen while the next one loads. Refreshes every 10 seconds while the
 * component that uses it is mounted and the page is visible, every 2 seconds for 20 seconds after a redeliver while a
 * row is pending or sending (modules/WebhookDeliveries.js refreshInterval).
 *
 * @param {number} id
 * @param {Object} options
 * @param {number} options.page  zero-based page
 * @param {number} options.size  rows per page
 */
const useWebhookDeliveries = (id, { page = 0, size = 25 } = {}) => {
	const result = useQuery({
		queryKey: ["webhook-deliveries", id, { page, size }],
		queryFn: () => getWebhookDeliveries(id, { limit: size, offset: page * size }),
		placeholderData: keepPreviousData,
		refetchInterval: (query) => refreshInterval(query.state.data?.data ?? [], watchUntil.get(id) ?? 0, Date.now()),
		staleTime: 0,
	});
	return { ...result, rows: result.data?.data ?? [], total: result.data?.total ?? null };
};

// Variables: the delivery id of a failed row; the webhook's list shows its last delivery, so it refreshes too
const useRedeliverWebhook = (id) => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (deliveryId) => redeliverWebhook(id, deliveryId),
		onSuccess: () => watchUntil.set(id, Date.now() + WATCH_MS),
		onSettled: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: ["webhook-deliveries", id] }),
				queryClient.invalidateQueries({ queryKey: ["webhooks"] }),
			]),
	});
};

export {
	INVALIDATIONS as WEBHOOK_INVALIDATIONS,
	useRedeliverWebhook,
	useSaveWebhook,
	useTestWebhook,
	useWebhookDeliveries,
	useWebhooks,
};
