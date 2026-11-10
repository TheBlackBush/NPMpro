import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HOST_TYPES, saveInvalidations } from "src/modules/HostTypes";

const STALE_MS = 60 * 1000;

/**
 * The read, list and save hooks of a host type, on the query keys of HOST_TYPES
 *
 * @param {string}   type          dead, redirection, stream or proxy
 * @param {Object}   requests
 * @param {Function} requests.get     (id) => the host
 * @param {Function} requests.getAll  (expand) => the list
 * @param {Function} requests.create  (values) => the new host
 * @param {Function} requests.update  (values with id) => the host
 * @param {Function} requests.empty   () => the host of a new window (id "new")
 */
export function createHostHooks(type, { get, getAll, create, update, empty }) {
	const { itemKey, listKey } = HOST_TYPES[type];
	const readOne = (id) =>
		useQuery({
			queryKey: [itemKey, id],
			queryFn: () => (id === "new" ? Promise.resolve(empty()) : get(id)),
			staleTime: STALE_MS,
		});
	const readList = (expand) =>
		useQuery({
			queryKey: [listKey, { expand }],
			queryFn: () => getAll(expand),
			staleTime: STALE_MS,
		});
	const save = () => {
		const queryClient = useQueryClient();
		return useMutation({
			mutationFn: (values) => (values.id ? update(values) : create(values)),
			onSuccess: async ({ id }) => {
				await Promise.all(
					saveInvalidations(type, id).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
				);
			},
		});
	};
	return { useOne: readOne, useList: readList, useSave: save };
}
