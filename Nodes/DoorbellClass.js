/* eslint-disable max-len */
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

      if (deviceData) {
        // The new /integrations/v1 api may miss the the battery_life property
        // if it is offline, or wired. So we default a value of 100% charged.
        if (!('battery_life' in deviceData)) {
          // logger.error('getDeviceData had no battery_life. Defaults to 100: %o',
          //   deviceData);
          deviceData.battery_life = 100;
        } else if (deviceData.battery_life > 100) {
          // The new API has a battery_life in percentage only. Check it.
          logger.error('getDeviceData had an erroneous battery_life: %s. ' +
            'Override to 100: %o',
            deviceData.battery_life,
            deviceData);
          deviceData.battery_life = 100;
        }

        // logger.info('This doorbell Data %o', deviceData);
        logger.info('Doorbell %s battery_life set to %s',
          id, deviceData.battery_life);

        if ('battery_life_2' in deviceData) {
          if (deviceData.battery_life_2 > 100) {
            // The new API has a battery_life in percentage only. Check it.
            logger.error('getDeviceData had an erroneous battery_life_2: %s. ' +
              'Override to 100: %o',
              deviceData.battery_life_2,
              deviceData);
            deviceData.battery_life_2 = 100;
          } else {
            logger.info('Doorbell %s battery_life_2 set to %s',
              id, deviceData.battery_life_2);

            this.setDriver('BAT2', deviceData.battery_life_2, false);
          }
        }

        this.setDriver('ST', deviceData.battery_life, false);
        this.setDriver('ERR', '0', false);
        this.reportDrivers(true); // Always report, event if it has not changed.
      } else {
        logger.error('getDeviceData - device not found or incorrect: %o',
          deviceData);
        this.setDriver('ERR', '1'); // Will be reported if changed
      }
    }
  }

  return Doorbell;
};
