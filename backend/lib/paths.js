// The container's fixed paths. Tests run the real backend under a temporary root; in the container the root is empty.
const root = process.env.NPMPRO_TEST_ROOT ?? "";

/**
 * @param   {string}  file  an absolute path of the container
 * @returns {string}
 */
const rooted = (file) => `${root}${file}`;

export { rooted };
