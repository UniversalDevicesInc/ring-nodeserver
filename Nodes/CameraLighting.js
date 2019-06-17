'use strict';

// This is a node created for cameras that have a Floodlight

// nodeDefId must match the nodedef in the profile
const nodeDefId = 'FLOOD';

module.exports = function(Polyglot) {
  // Utility function provided to facilitate logging.
  const logger = Polyglot.logger;

  // This is your custom Node class
  class Floodlight extends Polyglot.Node {

    // polyInterface: handle to the interface
    // primary: Same as address, if the node is a primary node
    // address: Your node address, without the leading 'n999_'
    // name: Your node name
    // id is the nodedefId
    constructor(polyInterface, primary, address, name, id) {
      super(nodeDefId, polyInterface, primary, address, name);

      this.ringInterface =
        require('../lib/ringInterface.js')(Polyglot, polyInterface);

      // REF: https://github.com/UniversalDevicesInc/hints
      this.hint = '0x01021001'; // See hints.yaml - It's a non-dimming light

      // Remove the last character. ISY addresses are the Ring ID followed by f
      this.ringAddress = address.slice(0, -1);

      // Commands that this node can handle.
      // Should match the 'accepts' section of the nodedef.
      this.commands = {
        DON: this.onDON,
        DOF: this.onDOF,
      };

      // Unfortunately floodlights don't have a status.
      this.drivers = {};
    }

    async onDON() {
      logger.info('DON triggered for %s (Floodlight)', this.address);

      await this.ringInterface.floodlightOn(this.ringAddress);
      this.reportCmd('DON'); // So that programs are triggered
    }

    async onDOF() {
      logger.info('DOF triggered for %s (Floodlight)', this.address);

      await this.ringInterface.floodlightOff(this.ringAddress);
      this.reportCmd('DOF'); // So that programs are triggered
    }
  }

  // Required so that the interface can find this Node class using the nodeDefId
  Floodlight.nodeDefId = nodeDefId;

  return Floodlight;
};
