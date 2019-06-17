'use strict';

// This is a secondary node for Doorbells which sends DON on motion.

// nodeDefId must match the nodedef in the profile
const nodeDefId = 'DOORBELLM';

// Sends a DOF after motionEndTimer
const motionEndTimer = 8000; // 8 Seconds.

module.exports = function(Polyglot) {
  const logger = Polyglot.logger;

  class Doorbell extends Polyglot.Node {

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
      this.hint = '0x01030401'; // See hints.yaml - It's a motion sensor

      this.timer = null;

      // Commands that this node can handle.
      // Should match the 'accepts' section of the nodedef.
      this.commands = {
        DON: this.motion,
      };

      // Doorbell motion nodes have no status
      this.drivers = {};
    }

    async motion() {
      logger.info('Event manually triggered for %s: Motion', this.address);
      return this.activate();
    }

    // Runs when receiving event, or manually.
    async activate() {
      const _this = this;

      _this.reportCmd('DON'); // DON = Motion event

      if (this.timer) {
        clearTimeout(this.timer);
      }

      this.timer = setTimeout(
        function() {
          _this.reportCmd('DOF'); // DOF = No more motion
        },
        motionEndTimer
      );
    }
  }

  // Required so that the interface can find this Node class using the nodeDefId
  Doorbell.nodeDefId = nodeDefId;

  return Doorbell;
};
