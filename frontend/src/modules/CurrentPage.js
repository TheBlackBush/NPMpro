/**
 * Whether a host serves the page the browser is on, so disabling or deleting it may lock the user out of the app.
 * Pure, so node --test checks it without a DOM.
 */

/**
 * A name as the browser's location.hostname has it: trimmed, lower case, international names in punycode, no
 * trailing dot
 *
 * @param   {*} name
 * @returns {string}
 */
function asciiName(name) {
	const text = String(name ?? "")
		.trim()
		.toLowerCase();
	if (text === "") return "";
	let ascii = text;
	try {
		ascii = new URL(`http://${text}`).hostname;
	} catch {
		// not a host name (a regular expression): compared as it is, so it matches nothing
	}
	return ascii.endsWith(".") ? ascii.slice(0, -1) : ascii;
}

/**
 * Whether one domain name of a host covers a hostname, as nginx's server_name does: the same name, a wildcard
 * "*.example.com" for any name below example.com, or ".example.com" for example.com and any name below it. Regular
 * expressions (~) and wildcards at the end (www.example.*) are not checked.
 *
 * @param   {string} domain
 * @param   {string} hostname  location.hostname
 * @returns {boolean}
 */
export function domainCovers(domain, hostname) {
	const name = asciiName(domain);
	const host = asciiName(hostname);
	if (name === "" || host === "") return false;
	if (name === host) return true;
	if (name.startsWith("*.")) return host.endsWith(name.slice(1));
	if (name.startsWith(".")) return host === name.slice(1) || host.endsWith(name);
	return false;
}

/**
 * Whether a host with these domain names serves the page the browser is on
 *
 * @param   {string[]} domainNames
 * @param   {string}   hostname  location.hostname
 * @returns {boolean}
 */
export const servesCurrentPage = (domainNames, hostname) =>
	(domainNames ?? []).some((domain) => domainCovers(domain, hostname));
