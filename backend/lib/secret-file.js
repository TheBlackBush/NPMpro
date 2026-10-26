import { chmod, writeFile } from "node:fs/promises";

/**
 * Writes a file only its owner may read (private keys, htpasswd): 0600 at creation, and again when the file existed
 * (the mode option of writeFile only applies to a new file)
 *
 * @param   {String}         file
 * @param   {String|Buffer}  content
 * @returns {Promise}
 */
const writeSecretFile = async (file, content) => {
	await writeFile(file, content, { encoding: "utf8", mode: 0o600 });
	await chmod(file, 0o600);
};

export { writeSecretFile };
