import { useMutation, useQuery } from "@tanstack/react-query";
import { getDatabase, getDatabaseMove, startDatabaseMove, testDatabase } from "src/api/backend";

/**
 * The database in use, its tables and the last move; administrators only
 */
const useDatabase = () =>
	useQuery({
		queryKey: ["database"],
		queryFn: () => getDatabase(),
		staleTime: 10 * 1000,
	});

/**
 * The current or last move; polled every second while it runs
 */
const useDatabaseMove = (enabled = true) =>
	useQuery({
		queryKey: ["database-move"],
		queryFn: () => getDatabaseMove(),
		enabled,
		refetchInterval: (query) => (query.state.data?.move?.state === "running" ? 1000 : false),
	});

const useTestDatabase = () => useMutation({ mutationFn: (target) => testDatabase(target) });

const useStartDatabaseMove = () => useMutation({ mutationFn: (target) => startDatabaseMove(target) });

export { useDatabase, useDatabaseMove, useStartDatabaseMove, useTestDatabase };
