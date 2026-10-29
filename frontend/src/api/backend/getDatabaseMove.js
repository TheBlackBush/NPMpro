import * as api from "./base";

export async function getDatabaseMove() {
	return await api.get({ url: "/database/move" });
}
