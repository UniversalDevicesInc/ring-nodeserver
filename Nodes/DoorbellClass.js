'use strict';

// This is the base class for the main node of a doorbell.
// It holds the battery status and sends DON on Ding events
// It supports the battery life_field with either mV or %

module.exports = function(Polyglot) {
  const logger = Polyglot.logger;

  // This is your custom Node class
  class Doorbell extends Polyglot.Node {

    // polyInterface: handle to the interface
    // primary: Same as address, if the node is a primary node
    // address: Your node address, without the leading 'n999_'
    // name: Your node name
    // id is the nodedefId
    constructor(nodeDefId, polyInterface, primary, address, name, id) {
      super(nodeDefId, polyInterface, primary, address, name);

      this.ringInterface =
        require('../lib/ringInterface.js')(Polyglot, polyInterface);

      // REF: https://github.com/UniversalDevicesInc/hints
      this.hint = '0x01080101'; // See hints.yaml

      // Commands that this node can handle.
      // Should match the 'accepts' section of the nodedef.
      this.commands = {
        DON: this.ding,
        QUERY: this.query,
      };

      // Should be set by the node inheriting this class
      // (Doorbell.js or DoorbellP.js)
      // this.drivers = {
      //   ST: { value: '', uom: 43 }, // Battery level in millivolt
      //   ERR: { value: '0', uom: 2 }, // In error?
      // };
    }

    async ding() {
      logger.info('Event manually triggered for %s: Ding', this.address);
      return this.activate();
    }

    // Runs when receiving event, or manually.
    async activate() {
      this.reportCmd('DON'); // DON = Ding event
    }

    // query is called from polling. If so, we have device data pre fetched.
    async query(queryCmd, preFetched = null) {
      const id = this.address;
      const deviceData = await this.ringInterface.getDeviceData(id, preFetched);

      if (deviceData && 'battery_life' in deviceData) {
        // logger.info('This doorbell Data %o', deviceData);
        logger.info('Doorbell %s battery_life set to %s',
          id, deviceData.battery_life);

        this.setDriver('ST', deviceData.battery_life, false);
        this.setDriver('ERR', '0', false);
        this.reportDrivers(); // Reports only changed values
      } else {
        logger.error('getDeviceData - device not found or incorrect: %o',
          deviceData);
        this.setDriver('ERR', '1'); // Will be reported if changed
      }
    }
  }

  return Doorbell;
};
