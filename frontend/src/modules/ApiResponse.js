/**
 * The JSON body of an API answer. A 204 has no body and gives null; an empty or broken body of another successful
 * answer throws; of a failed answer it gives an empty object (the status is the message then).
 *
 * @param   {Response}  response
 * @returns {Promise<Object|null>}
 */
const readPayload = async (response) => {
	if (response.status === 204) return null;
	try {
		return await response.json();
	} catch (err) {
		if (response.ok) throw err;
		return {};
	}
};

export { readPayload };
