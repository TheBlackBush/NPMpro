import { execFileSync, spawnSync } from "node:child_process";

export const opensslMissing = spawnSync("openssl", ["version"]).status !== 0;

/**
 * A client certificate and key in PEM, a DER copy of the certificate and an encrypted copy of the key, made by openssl
 *
 * @param   {string} dir
 * @returns {{ crt: string, key: string, der: string, encrypted: string }}
 */
export const clientPemFiles = (dir) => {
	const files = {
		crt: `${dir}/client.crt`,
		key: `${dir}/client.key`,
		der: `${dir}/client.der`,
		encrypted: `${dir}/client-enc.key`,
	};
	const run = (args) => execFileSync("openssl", args, { stdio: "ignore" });
	run([
		"req",
		"-x509",
		"-newkey",
		"ec",
		"-pkeyopt",
		"ec_paramgen_curve:P-256",
		"-nodes",
		"-keyout",
		files.key,
		"-out",
		files.crt,
		"-days",
		"1",
		"-subj",
		"/CN=bouncer",
	]);
	run(["x509", "-in", files.crt, "-outform", "DER", "-out", files.der]);
	run(["pkey", "-in", files.key, "-aes256", "-passout", "pass:secret", "-out", files.encrypted]);
	return files;
};
