/**
 * n8n loads the node and credential classes from the paths in the `n8n` block
 * of package.json, not from here. This file exists because npm expects `main`
 * to resolve; requiring the package directly is not a supported use.
 */
module.exports = {};
