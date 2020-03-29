'use strict';

// This is the main node for a camera with a Battery Life reporting in mV
// It holds the battery status and sends DON on Motion events
// This is no longer used, except to support migrating to Percent

const cameraClass = require('./CameraClass.js');

// nodeDefId must match the nodedef in the profile
const nodeDefId = 'CAM';

module.exports = function(Polyglot) {
  class Camera extends cameraClass(Polyglot) {

    constructor(polyInterface, primary, address, name, id) {
      super(nodeDefId, polyInterface, primary, address, name);

      this.drivers = {
        ST: { value: '', uom: 43 }, // Battery level in mV
        ERR: { value: '0', uom: 2 }, // In error?
      };

      // The following is inherited from the cameraClass
      // this.ringInterface
      // this.hint
      // this.commands = {
      //   DON: this.motion,
      //   QUERY: this.query,
      // };
    }

    // See CameraClass.js
    // async motion() {}
    // async activate() {}
    // async query() {}
  }

  // Required so that the interface can find this Node class using the nodeDefId
  Camera.nodeDefId = nodeDefId;

  return Camera;
};
