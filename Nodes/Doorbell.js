'use strict';

// nodeDefId must match the nodedef in the profile
const nodeDefId = 'DOORBELL';

module.exports = function(Polyglot) {
  // Utility function provided to facilitate logging.
  const logger = Polyglot.logger;

  // This is your custom Node class
  class Doorbell extends Polyglot.Node {

    // polyInterface: handle to the interface
    // primary: Same as address, if the node is a primary node
    // address: Your node address, withouth the leading 'n999_'
    // name: Your node name
    // id is the nodedefId
    constructor(polyInterface, primary, address, name, id) {
      super(nodeDefId, polyInterface, primary, address, name);

      this.ringInterface =
        require('../lib/ringInterface.js')(Polyglot, polyInterface);

      // PGC supports setting the node hint when creating a node
      // REF: https://github.com/UniversalDevicesInc/hints
      // Must be a string in this format
      // If you don't care about the hint, just comment the line.
      this.hint = '0x01080101'; // See hints.yaml

      // Commands that this node can handle.
      // Should match the 'accepts' section of the nodedef.
      this.commands = {
        DON: this.ding,
        QUERY: this.query,
      };

      // Status that this node has.
      // Should match the 'sts' section of the nodedef.
      // Must all be strings
      this.drivers = {
        ST: { value: '', uom: 43 }, // Battery level in millivolt
        ERR: { value: '0', uom: 2 }, // In error?
      };
    }

    async ding() {
      logger.info('Event manually triggered for %s: Ding', this.address);
      this.reportCmd('DON'); // DON = Ding event
    }

    async query() {
      const id = this.address;
      const doorbellData = await this.ringInterface.getDoorbellData(id);

      if (doorbellData && 'battery_life' in doorbellData) {
        // logger.info('This doorbell Data %o', doorbellData);
        logger.info('Doorbell battery_life set to %s',
          doorbellData.battery_life);

        this.setDriver('ST', doorbellData.battery_life, false);
        this.setDriver('ERR', '0', false);
        this.reportDrivers(); // Reports only changed values
      } else {
        logger.error('API result for getDoorbellData is incorrect: %o',
          doorbellData);
        this.setDriver('ERR', '1'); // Will be reported if changed
      }
    }
  }

  // Required so that the interface can find this Node class using the nodeDefId
  Doorbell.nodeDefId = nodeDefId;

  return Doorbell;
};
