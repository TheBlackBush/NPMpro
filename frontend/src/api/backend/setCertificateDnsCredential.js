import * as api from "./base";

export async function setCertificateDnsCredential(certificateId, npmproDnsCredentialId) {
	return await api.put({
		url: `/nginx/certificates/${certificateId}/dns-credential`,
		data: { npmproDnsCredentialId },
	});
}
