'use strict';

// The controller node is a regular ISY node. It must be the first node created
// by the node server. It has an ST status showing the nodeserver status, and
// optionally node statuses. It usually has a few commands on the node to
// facilitate interaction with the nodeserver from the admin console or
// ISY programs.

// nodeDefId must match the nodedef id in your nodedef
const nodeDefId = 'CONTROLLER';

// Those devices return battery_life in mV as per Pradeep... but not true...
// const mvDevices = [
//   'lpd_v1', // Doorbell
//   'lpd_v2', // Doorbell
//   'stickup_cam_elite',
//   'jbox',
//   'hp_cam_v1',
//   'hp_cam_v2',
// ];

// Those devices have lighting capability
const cameraLighting = [
  // 'stickup_cam_elite', // Has no lighting capability
  // 'jbox', // Not sure what that device is.

  /floodlight/, // If any device has floodlight in its name
  // 'floodlight_v2', // Has floodlights
  // 'cocoa_floodlight', // New kind of floodlight
  'hp_cam_v1', // Has floodlights - Confirmed by MWareman
  'hp_cam_v2', // Has floodlights - Confirmed by MWareman
];


module.exports = function(Polyglot, subscribe) {
  const logger = Polyglot.logger;

  // Nodes created during discovery
  const Doorbell = require('./Doorbell.js')(Polyglot);
  const DoorbellP = require('./DoorbellP.js')(Polyglot);
  const DoorbellMotion = require('./DoorbellMotion.js')(Polyglot);
  const Camera = require('./Camera.js')(Polyglot);
  const CameraP = require('./CameraP.js')(Polyglot);
  const CameraLight = require('./CameraLighting.js')(Polyglot);

  class Controller extends Polyglot.Node {
    // polyInterface: handle to the interface
    // address: Your node address, withouth the leading 'n999_'
    // primary: Same as address, if the node is a primary node
    // name: Your node name
    constructor(polyInterface, primary, address, name) {
      super(nodeDefId, polyInterface, primary, address, name);

      this.subscribeEvents = subscribe;
      this.ringInterface =
        require('../lib/ringInterface.js')(Polyglot, polyInterface);

      // Commands that this controller node can handle.
      // Should match the 'accepts' section of the nodedef.
      this.commands = {
        DISCOVER: this.onDiscover,
        UPDATE_PROFILE: this.onUpdateProfile,
        QUERY: this.query,
      };

      // Status that this controller node has.
      // Should match the 'sts' section of the nodedef.
      this.drivers = {
        ST: { value: '1', uom: 2 }, // uom 2 = Boolean. '1' is True.
      };

      this.isController = true;
    }

    // Sends the profile files to ISY
    onUpdateProfile() {
      logger.info('Updating profile');
      this.polyInterface.updateProfile();
    }

    isPercent(device) {
      // if (mvDevices.includes(device.kind)) {
      //   return false; // Devices return battery_life in mV
      // }

      // Assume it is returning in percentage if between 0 and 100.
      // Otherwise, mV
      // return device.battery_life <= 100;

      // 2020-03-23 Dan from Ring confirmed all battery_life values are now
      // in Percent
      return true;
    }

    // Discover Doorbells
    async onDiscover() {
      const _this = this;
      try {
        logger.info('Discovering new devices');

        const getDevicesResult = await this.ringInterface.getOwnerDevices();
        // logger.info('Devices result: %o', getDevicesResult);

        if (getDevicesResult) {
          // ----- Doorbells -----
          const doorbells = getDevicesResult.doorbells
          .concat(getDevicesResult.authorized_doorbells);

          logger.info('Doorbells: %o', doorbells);

          const addResults = await Promise.all(
            doorbells.map(function(doorbell) {
              return _this.autoAddDoorbell(doorbell, false);
            })
          );

          logger.info('Doorbells: %d, added to Polyglot: %d',
            doorbells.length,
            addResults.filter(function(db) {
              return db && db.added;
            }).length,
          );

          // ----- Cameras -----
          const cams = getDevicesResult.stickup_cams;

          logger.info('Cameras: %o', cams);

          const camsAddResults = await Promise.all(cams.map(function(cam) {
            return _this.autoAddCameraNode(cam);
          }));

          logger.info('Cameras: %d, added to Polyglot: %d',
            cams.length,
            camsAddResults.filter(function(c) {
              return c && c.added;
            }).length,
          );

          // Automatically subscribe to events
          this.subscribeEvents();
        }
      } catch (err) {
        logger.errorStack(err, 'Error discovering devices:');
      }
    }

    async autoAddDoorbell(doorbell) {
      let added = false;
      const id = typeof doorbell.id === 'string' ?
        doorbell.id : doorbell.id.toString();
      const deviceAddress = id;
      const node = this.polyInterface.getNode(deviceAddress); // id is 5 digits
      const desc = doorbell.description;
      const kind = doorbell.kind;
      const isPercent = this.isPercent(doorbell);
      const batteryLifeType = isPercent ? 'Percent' : 'mV';

      if (!node) {
        try {
          logger.info('Adding doorbell node %s kind %s (%s): %s',
            deviceAddress, kind, batteryLifeType, desc);

          await this.polyInterface.addNode(
            new (isPercent ? DoorbellP : Doorbell)(
              this.polyInterface,
              this.address, // primary
              deviceAddress,
              desc
            )
          );

          logger.info('Doorbell added node %s kind %s (%s): %s',
            deviceAddress, kind, batteryLifeType, desc);

          this.polyInterface.addNoticeTemp(
            'newDoorbell-' + deviceAddress,
            'New node created: ' + desc,
            5
          );

          added = true;

        } catch (err) {
          logger.errorStack(err, 'Doorbell add failed:');
        }
      } else {
        logger.info('Doorbell already exists: %s (%s)',
          deviceAddress, desc);
      }

      const motionAdded = await this.autoAddDoorbellMotionNode(doorbell);

      // Return true if any node was created.
      return { added: added || motionAdded.added };
    }

    async autoAddDoorbellMotionNode(device) {
      let added = false;
      const id = typeof device.id === 'string' ?
        device.id : device.id.toString();

      const deviceAddressMotion = id + 'm';
      const nodeMotion = this.polyInterface.getNode(deviceAddressMotion);
      const descMotion = device.description + ' motion';
      const kind = device.kind;

      if (!nodeMotion) {
        try {
          logger.info('Adding doorbell motion node %s kind %s: %s',
            deviceAddressMotion, kind, descMotion);

          await this.polyInterface.addNode(
            new DoorbellMotion(
              this.polyInterface,
              this.address, // primary
              deviceAddressMotion,
              descMotion
            )
          );

          logger.info('Doorbell motion node added nodedef %s kind %s: %s',
            deviceAddressMotion, kind, descMotion);

          this.polyInterface.addNoticeTemp(
            'newMotionNode-' + deviceAddressMotion,
            'New node created: ' + descMotion,
            5
          );

          added = true;

        } catch (err) {
          logger.errorStack(err, 'Doorbell motion node add failed:');
        }
      } else {
        logger.info('Doorbell motion node already exists: %s (%s)',
          deviceAddressMotion, descMotion);
      }

      return { added: added }; // Return true if node added
    }

    async autoAddCameraNode(device) {
      let added = false;
      const id = typeof device.id === 'string' ?
        device.id : device.id.toString();

      const deviceAddressMotion = id + 'm';
      const nodeMotion = this.polyInterface.getNode(deviceAddressMotion);
      const descMotion = device.description + ' motion';
      const kind = device.kind;
      const isPercent = this.isPercent(device);
      const batteryLifeType = isPercent ? 'Percent' : 'mV';

      if (!nodeMotion) {
        try {
          logger.info('Adding camera node %s kind %s (%s): %s',
            deviceAddressMotion, kind, batteryLifeType, descMotion);

          await this.polyInterface.addNode(
            new (isPercent ? CameraP : Camera)(
              this.polyInterface,
              this.address, // primary
              deviceAddressMotion,
              descMotion
            )
          );

          logger.info('Camera node added %s kind %s (%s): %s',
            deviceAddressMotion, kind, batteryLifeType, descMotion);

          this.polyInterface.addNoticeTemp(
            'newMotionNode-' + deviceAddressMotion,
            'New node created: ' + descMotion,
            5
          );

          added = true;

        } catch (err) {
          logger.errorStack(err, 'Motion node add failed:');
        }
      } else {
        logger.info('Motion node already exists: %s (%s)',
          deviceAddressMotion, descMotion);
      }

      let floodAdded = false;

      // if (cameraLighting.includes(kind)) {
      if (cameraLighting.some(k => k===kind || (k instanceof RegExp && k.test(kind)))) {
        floodAdded = await this.autoAddCameraFloodlightNode(device);
      }

      return { added: added || floodAdded.added };
    }

    async autoAddCameraFloodlightNode(device) {
      let added = false;
      const id = typeof device.id === 'string' ?
        device.id : device.id.toString();

      const deviceAddressFlood = id + 'l';
      const nodeFlood = this.polyInterface.getNode(deviceAddressFlood);
      const descFlood = device.description + ' light';
      const kind = device.kind;

      if (!nodeFlood) {
        try {
          logger.info('Adding camera lighting node %s kind %s: %s',
            deviceAddressFlood, kind, descFlood);

          await this.polyInterface.addNode(
            new CameraLight(
              this.polyInterface,
              this.address, // primary
              deviceAddressFlood,
              descFlood
            )
          );

          logger.info('Camera lighting node added %s kind %s: %s',
            deviceAddressFlood, kind, descFlood);

          this.polyInterface.addNoticeTemp(
            'newLightNode-' + deviceAddressFlood,
            'New node created: ' + descFlood,
            5
          );

          added = true;

        } catch (err) {
          logger.errorStack(err, 'Camera lighting node add failed:');
        }
      } else {
        logger.info('Camera lighting node already exists: %s (%s)',
          deviceAddressFlood, descFlood);
      }

      return { added: added }; // Return true if node added
    }
  }

  // Required so that the interface can find this Node class using the nodeDefId
  Controller.nodeDefId = nodeDefId;

  return Controller;
};


// Those are the standard properties of every nodes:
// this.id              - Nodedef ID
// this.polyInterface   - Polyglot interface
// this.primary         - Primary address
// this.address         - Node address
// this.name            - Node name
// this.timeAdded       - Time added (Date() object)
// this.enabled         - Node is enabled?
// this.added           - Node is added to ISY?
// this.commands        - List of allowed commands
//                        (You need to define them in your custom node)
// this.drivers         - List of drivers
//                        (You need to define them in your custom node)

// Those are the standard methods of every nodes:
// Get the driver object:
// this.getDriver(driver)

// Set a driver to a value (example set ST to 100)
// this.setDriver(driver, value, report=true, forceReport=false, uom=null)

// Send existing driver value to ISY
// this.reportDriver(driver, forceReport)

// Send existing driver values to ISY
// this.reportDrivers()

// When we get a query request for this node.
// Can be overridden to actually fetch values from an external API
// this.query()

// When we get a status request for this node.
// this.status()
