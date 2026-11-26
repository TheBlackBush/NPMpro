import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	getEmailSettings,
	getNotificationEvents,
	getNotificationSettings,
	sendSampleAlert,
	sendTestMail,
	updateEmailSettings,
	updateNotificationSettings,
} from "src/api/backend";

// options: a page that only reads the settings on the side passes { retry: false } so a failure ends at once
const useEmailSettings = (options = {}) =>
	useQuery({
		queryKey: ["email-settings"],
		queryFn: () => getEmailSettings(),
		staleTime: 60 * 1000,
		...options,
	});

const useNotificationSettings = (options = {}) =>
	useQuery({
		queryKey: ["notification-settings"],
		queryFn: () => getNotificationSettings(),
		staleTime: 60 * 1000,
		...options,
	});

// a save changes the Environment page's locks and the audit log; the mail server also what the other sections offer
const useInvalidateNotifications = () => {
	const queryClient = useQueryClient();
	return () =>
		Promise.all(
			[["email-settings"], ["notification-settings"], ["audit-logs"], ["environment"], ["health"]].map(
				(queryKey) => queryClient.invalidateQueries({ queryKey }),
			),
		);
};

const useSaveEmailSettings = () => {
	const invalidate = useInvalidateNotifications();
	return useMutation({ mutationFn: (values) => updateEmailSettings(values), onSuccess: invalidate });
};

const useSaveNotificationSettings = () => {
	const invalidate = useInvalidateNotifications();
	return useMutation({ mutationFn: (values) => updateNotificationSettings(values), onSuccess: invalidate });
};

// the events the mail channel offers; they only change with a new version
const useNotificationEvents = (options = {}) =>
	useQuery({
		queryKey: ["notification-events"],
		queryFn: () => getNotificationEvents(),
		staleTime: 10 * 60 * 1000,
		...options,
	});

const useSendSampleAlert = () => useMutation({ mutationFn: () => sendSampleAlert() });

const useSendTestMail = () => useMutation({ mutationFn: (to) => sendTestMail(to) });

export {
	useEmailSettings,
	useNotificationEvents,
	useNotificationSettings,
	useSaveEmailSettings,
	useSaveNotificationSettings,
	useSendSampleAlert,
	useSendTestMail,
};
