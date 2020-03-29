'use strict';

// This is the main node for a doorbell with a Battery Life reporting in mV
// It holds the battery status and sends DON on Ding events
// This is no longer used, except to support migrating to Percent

const doorbellClass = require('./DoorbellClass');

// nodeDefId must match the nodedef in the profile
const nodeDefId = 'DOORBELL';

module.exports = function(Polyglot) {
  class Doorbell extends doorbellClass(Polyglot) {

    // polyInterface: handle to the interface
    // primary: Same as address, if the node is a primary node
    // address: Your node address, without the leading 'n999_'
    // name: Your node name
    // id is the nodedefId
    constructor(polyInterface, primary, address, name, id) {
      super(nodeDefId, polyInterface, primary, address, name, id);

      this.drivers = {
        ST: { value: '', uom: 43 }, // Battery level in mV
        ERR: { value: '0', uom: 2 }, // In error?
      };

      // The following is inherited from the doorbellClass
      // this.ringInterface
      // this.hint
      // this.commands = {
      //   DON: this.ding,
      //   QUERY: this.query,
      // };
    }

    // See doorbellClass.js
    // async ding() {}
    // async activate() {}
    // async query(preFetched) {}
  }

  // Required so that the interface can find this Node class using the nodeDefId
  Doorbell.nodeDefId = nodeDefId;

  return Doorbell;
};
