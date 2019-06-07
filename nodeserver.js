'use strict';

trapUncaughExceptions();

const AsyncLock = require('async-lock');

// Loads PGC interface. This nodeserver does not support on prem polyglot.
const Polyglot = require('pgc_interface');

const logger = Polyglot.logger;
const lock = new AsyncLock({ timeout: 500 });
const controllerAddress = 'controller';

const Controller = require('./Nodes/ControllerNode.js')(Polyglot, subscribe);
const Doorbell = require('./Nodes/Doorbell.js')(Polyglot);
const DoorbellMotion = require('./Nodes/DoorbellMotion.js')(Polyglot);
const Camera = require('./Nodes/Camera.js')(Polyglot);

logger.info('-------------------------------------------------------');
logger.info('Starting Ring Node Server');

// Create an instance of the Polyglot interface. We need to pass all the node
// classes that we will be using.
const poly = new Polyglot.Interface([
  Controller, Doorbell, DoorbellMotion, Camera,
]);

// Ring API interface module
const ringInterface = require('./lib/ringInterface.js')(Polyglot, poly);

// Start web server which will receive Ring events when subscribed
// Events will be sent to ringInterface.eventProcessor
const ringEvents = require('./lib/ringEvents.js')(
  Polyglot, poly, ringInterface);

// Connected to MQTT, but config has not yet arrived.
poly.on('mqttConnected', function() {
  logger.info('MQTT Connection started');
});

// Config has been received
poly.on('config', function(config) {
  const nodesCount = Object.keys(config.nodes).length;
  logger.info('Config received has %d nodes', nodesCount);

  if (config.isInitialConfig) {
    logger.info('Received config: %o',
      Object.assign({}, config, {nodes: '<nodes>'}));
  }

  // Important config options:
  // config.nodes: Our nodes, with the node class applied
  // config.customParams: Configuration parameters from the UI
  // config.customData: Configuration data for the Nodeserver
  // config.newParamsDetected: Flag which tells us that customParams changed

  // If this is the first config after a node server restart
  if (config.isInitialConfig) {
    // The web server needs to setup the routes and start listening.
    ringEvents.start(config.worker);

    // Removes all existing notices on startup.
    poly.removeNoticesAll();

    if (!nodesCount) {
      logger.info('Sending profile files to ISY.');
      poly.updateProfile();

      // When Nodeserver is started for the first time, creation of the
      // controller fails if done too early.
      const createDelay = 5000;
      logger.info('Auto-creating controller in %s seconds', createDelay / 1000);
      setTimeout(function() {
        try {
          logger.info('Auto-creating controller');
          callAsync(autoCreateController());
        } catch (err) {
          logger.error('Error while auto-creating controller node:', err);
        }
      }, createDelay);
    } else {
      // If we have the controller we need to display the authorization notice
      // if we don't already have tokens. getAccessToken does this for us.
      callAsync(ringInterface.getAccessToken());
    }

    if (config.netInfo.publicPort) {

      try {
        // If we are configured correctly
        logger.info('Ring events server public interface is %s',
          config.netInfo.httpsIngress);

        subscribe();
      } catch (err) {
        logger.errorStack(err, 'Error subscribing:');
      }
    } else {
      logger.error('Public port not set. ' +
        'httpsIngress must be set in server.json. netInfo is %o',
        config.netInfo);
    }
  }
});

// This is triggered every x seconds. Frequency is configured in the UI.
poly.on('poll', function(longPoll) {
  callAsync(doPoll(longPoll));
});

// We receive this after a successful authorization
poly.on('oauth', function(oaMessage) {
  // oaMessage.code: Authorization code received from Ring after authorization
  // oaMessage.state: This must be the worker ID.

  logger.info('Received oAuth message %o', oaMessage);
  ringInterface.processAuthCode(oaMessage.code,
    oaMessage.state, controllerAddress);
});

// Received a 'stop' message from Polyglot. This NodeServer is shutting down
poly.on('stop', async function() {
  logger.info('Graceful stop');

  // Make a last short poll
  await doPoll(false);
  ringInterface.unsubscribe();

  // Tell Interface we are stopping (Our polling is now finished)
  poly.stop();
});

// Received a 'delete' message from Polyglot. This NodeServer is being removed
poly.on('delete', function() {
  logger.info('Nodeserver is being deleted');
  ringInterface.unsubscribe();

  // We can do some cleanup, then stop.
  poly.stop();
});

// MQTT connection ended
poly.on('mqttEnd', function() {
  logger.info('MQTT connection ended.'); // May be graceful or not.
});

// Triggered for every message received from polyglot.
// Can be used for troubleshooting.
// poly.on('messageReceived', function(message) {
//   // Only display messages other than config
//   if (!message['config']) {
//     logger.debug('Message: %o', message);
//   }
// });

// Triggered for every message received from polyglot.
// Can be used for troubleshooting.
// poly.on('messageSent', function(message) {
//   logger.debug('Message sent: %o', message);
// });

// This is being triggered based on the short and long poll parameters in the UI
async function doPoll(longPoll) {
  try {
    // Prevents polling logic reentry if an existing poll is underway
    await lock.acquire('poll-' + (longPoll ? 'long' : 'short'),
      async function() {
        logger.info('%s', longPoll ? 'Long poll' : 'Short poll');

        if (!longPoll) {
          // Short poll - We retrieve the battery status by querying all nodes
          const nodes = poly.getNodes();
          const preFetchedData = await ringInterface.getDevices();

          Object.keys(nodes).forEach(function(address) {
            if ('query' in nodes[address]) {
              nodes[address].query(preFetchedData);
            }
          });
        } else {
          // We retry a subscription. This also changes the pragma.
          subscribe();
        }
      }
    );
  } catch (err) {
    logger.error('Error while polling: %s', err.message);
  }
}

// Creates the controller node
async function autoCreateController() {
  try {
    await poly.addNode(
      new Controller(poly,
        controllerAddress, controllerAddress, 'Ring NodeServer')
    );

    // Add a notice in the UI
    poly.addNoticeTemp('newController', 'Controller node initialized', 5);

    // After we have the controller we need to display the authorization notice
    // getAccessToken does this for us.
    await ringInterface.getAccessToken();
  } catch (err) {
    logger.errorStack(err, 'Error creating controller node:');

    // Add a notice in the UI, and leave it there
    poly.addNotice('newController', 'Error creating controller node');
  }
}

// subscribe to Ring events
function subscribe() {
  return callAsync(ringInterface.subscribe());
}

// Call Async function from a non-async function without waiting for result
// and log the error if it fails
function callAsync(promise) {
  (async function() {
    try {
      await promise;
    } catch (err) {
      logger.error('Error with async function: %s',
        err.stack ? err.stack : err.message);
    }
  })();
}

function trapUncaughExceptions() {
  // If we get an uncaugthException...
  process.on('uncaughtException', function(err) {
    // Used in dev. Useful when logger is not yet defined.
    // Has logger been defined yet?
    if (logger) {
      logger.error(`uncaughtException REPORT THIS!: ${err.stack}`);
    } else {
      console.log('err', err); // Useful in dev only
    }
  });
}

// Starts the NodeServer!
poly.start();
