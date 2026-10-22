import * as api from "./base";

export async function setCertificateDnsCredential(certificateId, npmplusDnsCredentialId) {
	return await api.put({
		url: `/nginx/certificates/${certificateId}/dns-credential`,
		data: { npmplusDnsCredentialId },
	});
}
