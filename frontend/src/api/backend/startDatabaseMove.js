import * as api from "./base";

export async function startDatabaseMove(target) {
	return await api.post({ url: "/database/move", data: target });
}
