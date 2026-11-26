import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	getEmailSettings,
	getNotificationSettings,
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

const useSendTestMail = () => useMutation({ mutationFn: (to) => sendTestMail(to) });

export {
	useEmailSettings,
	useNotificationSettings,
	useSaveEmailSettings,
	useSaveNotificationSettings,
	useSendTestMail,
};
