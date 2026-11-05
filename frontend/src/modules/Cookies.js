const getCookie = (name) => {
	const value = `; ${document.cookie}`;
	const parts = value.split(`; ${name}=`);
	if (parts.length === 2) return parts.pop()?.split(";").shift();
};

/**
 * Expires a cookie the page can see (not httpOnly). A __Host- cookie needs Path=/ and Secure on the delete too.
 * document.cookie instead of the Cookie Store API, which Safari has only from 18.4 (the browser floor is 17.4).
 */
const deleteCookie = (name) => {
	// biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing in Safari before 18.4
	document.cookie = `${name}=; Max-Age=0; Path=/; Secure; SameSite=Strict`;
};

export { deleteCookie, getCookie };
