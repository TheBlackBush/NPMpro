import * as api from "./base";

export async function testDatabase(target) {
	return await api.post({ url: "/database/test", data: target });
}
