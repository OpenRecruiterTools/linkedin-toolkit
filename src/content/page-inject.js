/**
 * LinkedIn Toolkit — MAIN world page inject
 *
 * This script runs in the MAIN world (same JS context as LinkedIn's own code).
 * It sets a flag so that other scripts can detect the toolkit is installed,
 * and provides access to page-level APIs when needed.
 */

(function () {
  'use strict';

  // Signal that the toolkit is installed
  Object.defineProperty(window, '__liToolkitInstalled', {
    value: true,
    writable: false,
    configurable: false,
    enumerable: false,
  });
})();
