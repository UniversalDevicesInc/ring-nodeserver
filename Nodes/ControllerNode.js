'use strict';

// The controller node is a regular ISY node. It must be the first node created
// by the node server. It has an ST status showing the nodeserver status, and
// optionally node statuses. It usually has a few commands on the node to
// facilitate interaction with the nodeserver from the admin console or
// ISY programs.

// nodeDefId must match the nodedef id in your nodedef
const nodeDefId = 'CONTROLLER';

module.exports = function(Polyglot) {
  // Utility function provided to facilitate logging.
  const logger = Polyglot.logger;

  // In this example, we also need to have our custom node because we create
  // nodes from this controller. See onCreateNew
  const Doorbell = require('./Doorbell.js')(Polyglot);

  class Controller extends Polyglot.Node {
    // polyInterface: handle to the interface
    // address: Your node address, withouth the leading 'n999_'
    // primary: Same as address, if the node is a primary node
    // name: Your node name
    constructor(polyInterface, primary, address, name) {
      super(nodeDefId, polyInterface, primary, address, name);

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
      this.polyInterface.updateProfile();
    }

    // Discover Doorbells
    async onDiscover() {
      const _this = this;
      try {
        logger.info('Discovering new devices');

        const getDevicesResult = await this.ringInterface.getDevices();
        const doorbells = getDevicesResult.doorbells;

        logger.info('Doorbells: %o', doorbells);
        logger.info('Devices result: %o', getDevicesResult);

        const addResults = await Promise.all(doorbells.map(function(doorbell) {
          return _this.autoAddDoorbells(doorbell);
        }));

        logger.info('Doorbells: %d, added to Polyglot: %d',
          doorbells.length,
          addResults.filter(function(db) {
            return db && db.added;
          }).length,
        );
      } catch (err) {
        logger.errorStack(err, 'Error discovering devices:');
      }
    }

    async autoAddDoobell(doorbell) {
      const id = typeof doorbell.id === 'string' ?
        doorbell.id : vehicle.id.toString();
      const deviceAddress = id;
      const node = this.polyInterface.getNode(id); // id is 5 digits

      if (!node) {
        try {
          logger.info('Adding doorbell node %s: %s',
            deviceAddress, doorbell.description);

          const result = await this.polyInterface.addNode(
            new Doorbell(
              this.polyInterface,
              this.address, // primary
              deviceAddress,
              doorbell.description
            )
          );

          logger.info('Doorbell added: %s', result);
          this.polyInterface.addNoticeTemp(
            'newDoorbell-' + deviceAddress,
            'New node created: ' + doorbell.description,
            5
          );

          return { added: true };

        } catch (err) {
          logger.errorStack(err, 'Doorbell add failed:');
        }
      } else {
        logger.info('Doorbell already exists: %s (%s)',
          deviceAddress, doorbell.description);
      }
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


