'use strict';

const selfsigned = require('selfsigned');
// To be added to package.json if we re-add it.
// "selfsigned": "^1.10.4"


module.exports = function(commonName) {
  const attrs = [{ name: 'commonName', value: commonName }];

  return selfsigned.generate(attrs, {
    days: 365 * 20, // Cert expiry 20 years
  });
};


