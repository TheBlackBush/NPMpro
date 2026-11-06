import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";

const run = promisify(execFile);

/**
 * A key and certificate for a domain, made by the real openssl
 *
 * @param   {string}  dir     an existing folder
 * @param   {string}  domain
 * @param   {number}  [days]  validity
 * @returns {Promise<{ key: string, certificate: string }>}  file paths
 */
const makeCertificate = async (dir, domain, days = 30) => {
	const folder = await mkdtemp(path.join(dir, "cert-"));
	const key = path.join(folder, "key.pem");
	const certificate = path.join(folder, "cert.pem");
	await run("openssl", [
		"req",
		"-x509",
		"-newkey",
		"ec",
		"-pkeyopt",
		"ec_paramgen_curve:P-256",
		"-nodes",
		"-keyout",
		key,
		"-out",
		certificate,
		"-days",
		String(days),
		"-subj",
		`/CN=${domain}`,
		"-addext",
		`subjectAltName=DNS:${domain}`,
	]);
	return { key, certificate };
};

/**
 * A certificate that ended in 2020, signed by itself through "openssl ca" (req cannot make one with a negative validity)
 *
 * @param   {string}  dir     an existing folder
 * @param   {string}  domain
 * @returns {Promise<{ key: string, certificate: string }>}  file paths
 */
const makeExpiredCertificate = async (dir, domain) => {
	const folder = await mkdtemp(path.join(dir, "expired-"));
	const key = path.join(folder, "key.pem");
	const request = path.join(folder, "r.csr");
	const certificate = path.join(folder, "cert.pem");
	const config = path.join(folder, "ca.cnf");
	await writeFile(path.join(folder, "index.txt"), "");
	await writeFile(path.join(folder, "serial"), "01\n");
	await writeFile(
		config,
		`[ca]
default_ca = d
[d]
new_certs_dir = ${folder}
database = ${path.join(folder, "index.txt")}
serial = ${path.join(folder, "serial")}
default_md = sha256
policy = p
copy_extensions = copy
[p]
commonName = supplied
`,
	);
	await run("openssl", [
		"req",
		"-new",
		"-newkey",
		"ec",
		"-pkeyopt",
		"ec_paramgen_curve:P-256",
		"-nodes",
		"-keyout",
		key,
		"-out",
		request,
		"-subj",
		`/CN=${domain}`,
		"-addext",
		`subjectAltName=DNS:${domain}`,
	]);
	await run("openssl", [
		"ca",
		"-batch",
		"-config",
		config,
		"-selfsign",
		"-keyfile",
		key,
		"-in",
		request,
		"-out",
		certificate,
		"-startdate",
		"20200101000000Z",
		"-enddate",
		"20200102000000Z",
		"-notext",
	]);
	return { key, certificate };
};

/**
 * Makes the fake certbot behave like a successful run: certonly and renew put the files in the live folder, delete takes
 * them away, revoke does nothing. Every call also writes the environment it ran with to fake/certbot.env (read it with
 * certbotEnvironment).
 *
 * @param   {Object}  api          from startApi
 * @param   {string}  certificate  file path
 * @param   {string}  key          file path
 * @returns {Promise}
 */
const certbotSucceeds = (api, { certificate, key }) =>
	api.outside.hookCommand(
		"certbot",
		`#!/bin/sh
env > "${api.root}/fake/certbot.env"
name=""
action=""
while [ $# -gt 0 ]; do
	if [ "$1" = "--cert-name" ]; then name="$2"; fi
	case "$1" in certonly|renew|revoke|delete) [ -z "$action" ] && action="$1";; esac
	shift
done
[ -z "$name" ] && exit 0
live="${api.root}/data/tls/certbot/live/$name"
if [ "$action" = "delete" ]; then
	rm -rf "$live" "${api.root}/data/tls/certbot/renewal/$name.conf"
	exit 0
fi
[ "$action" = "revoke" ] && exit 0
mkdir -p "$live"
cp "${certificate}" "$live/fullchain.pem"
cp "${certificate}" "$live/cert.pem"
cp "${key}" "$live/privkey.pem"
touch "${api.root}/data/tls/certbot/renewal/$name.conf"
`,
	);

/**
 * Makes the fake certbot fail with an output (it still records its environment)
 *
 * @param   {Object}  api
 * @param   {string}  output  what certbot writes to stderr
 * @returns {Promise}
 */
const certbotFails = (api, output) =>
	api.outside.hookCommand(
		"certbot",
		`#!/bin/sh
env > "${api.root}/fake/certbot.env"
echo "${output}" >&2
exit 1
`,
	);

/**
 * The environment the fake certbot ran with last (certbotSucceeds writes it)
 *
 * @param   {Object}  api
 * @returns {Promise<Object>}  name to value
 */
const certbotEnvironment = async (api) =>
	Object.fromEntries(
		(await readFile(path.join(api.root, "fake/certbot.env"), "utf8"))
			.split("\n")
			.filter((line) => line.includes("="))
			.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
	);

/**
 * The files of a zip (stored or deflated entries, read from the central directory)
 *
 * @param   {Buffer}  bytes
 * @returns {Object}  file name to its content as a Buffer
 */
const readZip = (bytes) => {
	const end = bytes.lastIndexOf(Buffer.from("504b0506", "hex"));
	if (end < 0) throw new Error("not a zip file");
	const files = {};
	let at = bytes.readUInt32LE(end + 16);
	for (let n = bytes.readUInt16LE(end + 10); n > 0; n -= 1) {
		const method = bytes.readUInt16LE(at + 10);
		const size = bytes.readUInt32LE(at + 20);
		const nameLength = bytes.readUInt16LE(at + 28);
		const skip = bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
		const local = bytes.readUInt32LE(at + 42);
		const name = bytes.toString("utf8", at + 46, at + 46 + nameLength);
		const data = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
		const raw = bytes.subarray(data, data + size);
		files[name] = method === 0 ? raw : inflateRawSync(raw);
		at += 46 + nameLength + skip;
	}
	return files;
};

export { certbotEnvironment, certbotFails, certbotSucceeds, makeCertificate, makeExpiredCertificate, readZip };
