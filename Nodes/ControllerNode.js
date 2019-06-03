'use strict';

// The controller node is a regular ISY node. It must be the first node created
// by the node server. It has an ST status showing the nodeserver status, and
// optionally node statuses. It usually has a few commands on the node to
// facilitate interaction with the nodeserver from the admin console or
// ISY programs.

// nodeDefId must match the nodedef id in your nodedef
const nodeDefId = 'CONTROLLER';

module.exports = function(Polyglot, subscribe) {
  // Utility function provided to facilitate logging.
  const logger = Polyglot.logger;

  // In this example, we also need to have our custom node because we create
  // nodes from this controller. See onDiscover
  const Doorbell = require('./Doorbell.js')(Polyglot);
  const DoorbellMotion = require('./DoorbellMotion.js')(Polyglot);
  const Camera = require('./Camera.js')(Polyglot);

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

    // Discover Doorbells
    async onDiscover() {
      const _this = this;
      try {
        logger.info('Discovering new devices');

        const getDevicesResult = await this.ringInterface.getDevices();
        // logger.info('Devices result: %o', getDevicesResult);

        // ----- Doorbells -----
        const doorbells = getDevicesResult.doorbells
        .concat(getDevicesResult.authorized_doorbells);

        logger.info('Doorbells: %o', doorbells);

        const addResults = await Promise.all(doorbells.map(function(doorbell) {
          return _this.autoAddDoorbell(doorbell, false);
        }));

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
          return _this.autoAddMotionNode(cam, false);
        }));

        logger.info('Cameras: %d, added to Polyglot: %d',
          cams.length,
          camsAddResults.filter(function(c) {
            return c && c.added;
          }).length,
        );

        // Automatically subscribe to events
        this.subscribeEvents();
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

      if (!node) {
        try {
          logger.info('Adding doorbell node %s: %s',
            deviceAddress, desc);

          await this.polyInterface.addNode(
            new Doorbell(
              this.polyInterface,
              this.address, // primary
              deviceAddress,
              desc
            )
          );

          logger.info('Doorbell added: %s', desc);
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

      const motionAdded = await this.autoAddMotionNode(doorbell, true);

      // Return true if any node was created.
      return { added: added || motionAdded };
    }

    async autoAddMotionNode(device, isDoorbell = false) {
      let added = false;
      const id = typeof device.id === 'string' ?
        device.id : device.id.toString();

      const deviceAddressMotion = id + 'm';
      const nodeMotion = this.polyInterface.getNode(deviceAddressMotion);
      const descMotion = device.description + ' motion';
      const kind = device.kind;
      const kindNodedefs = {
        stickup_cam_elite: Camera, // With battery_life
        hp_cam_v1: Camera,
        hp_cam_v2: Camera,
      };

      // Nodedef for doorbell motion node is DoorbellMotion
      // Default Nodedef for camera nodes is Camera
      const Nodedef = isDoorbell ? DoorbellMotion :
        (kindNodedefs[device.kind] ? kindNodedefs[device.kind] : Camera);

      if (!nodeMotion) {
        try {
          logger.info('Adding motion node kind %s %s: %s',
            kind, deviceAddressMotion, descMotion);

          await this.polyInterface.addNode(
            new Nodedef(
              this.polyInterface,
              this.address, // primary
              deviceAddressMotion,
              descMotion
            )
          );

          logger.info('Motion node added nodedef %s: %s',
            Nodedef.nodeDefId, descMotion);

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

      return { added: added }; // Return true if either node.
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


