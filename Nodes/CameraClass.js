/* eslint-disable max-len */
'use strict';

// This is the base class for the main node for a camera.
// It holds the battery status and sends DON on motion
// It supports the battery_life field as either mV and %

// Sends a DOF after motionEndTimer
const motionEndTimer = 8000; // 8 Seconds.

module.exports = function(Polyglot) {
  const logger = Polyglot.logger;

  // This is your custom Node class
  class Camera extends Polyglot.Node {

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
      this.hint = '0x01030401'; // See hints.yaml - It's a motion sensor

      this.timer = null;

      // Commands that this node can handle.
      // Should match the 'accepts' section of the nodedef.
      this.commands = {
        DON: this.motion,
        QUERY: this.query,
      };

      // Status that this node has.
      // Should match the 'sts' section of the nodedef.
      // Must all be strings
      // This is set by Camera.js or CameraP.js
      // this.drivers = {
      //   ST: { value: '', uom: 43 }, // Battery level in millivolt
      //   ERR: { value: '0', uom: 2 }, // In error?
      // };
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

    // query is called from polling. If so, we have device data pre fetched.
    async query(queryCmd, preFetched = null) {
      const id = this.address;
      const deviceData = await this.ringInterface.getDeviceData(id, preFetched);

      if (deviceData) {
        // The new /integrations/v1 api may miss the the battery_life property
        // if it is offline, or wired. So we default a value of 100% charged.
        if (!('battery_life' in deviceData)) {
          // logger.error('getDeviceData had no battery_life. Defaults to 100.');
          deviceData.battery_life = 100;
        } else if (deviceData.battery_life > 100) {
          // The new API has a battery_life in percentage only. Check it.
          logger.error('getDeviceData had an erroneous battery_life: %s. ' +
            'Override to 100: %o',
            deviceData.battery_life,
            deviceData);
          deviceData.battery_life = 100;
        }

        logger.info('Device %s battery_life set to %s',
          id, deviceData.battery_life);

        this.setDriver('ST', deviceData.battery_life, false);
        this.setDriver('ERR', '0', false);
        this.reportDrivers(); // Reports only changed values
      } else {
        logger.error('API result for getDeviceData is incorrect: %o',
          deviceData);
        this.setDriver('ERR', '1'); // Will be reported if changed
      }
    }
  }

  return Camera;
};
