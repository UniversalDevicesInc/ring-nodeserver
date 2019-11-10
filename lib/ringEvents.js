'use strict';

// Contains the web server to receive Ring events such as Ding and motion

// const https = require('https');
const express = require('express');
const bodyParser = require('body-parser');

const jsonParser = bodyParser.json();
const ringLocalPort = 3000;

// Polyglot is the PGC module (Does not support Polyglot-V2 due to oAuth
// polyInterface is the instantiated Polyglot interface module
module.exports = function(Polyglot, polyInterface, ringInterface) {
  const logger = Polyglot.logger;

  class RingEventsServer {

    constructor(polyInterface) {
      this.polyInterface = polyInterface;
      this.app = express();
    }

    // When we know the worker ID, setup the route to handle events
    start(worker) {
      const basePath = '/ns/' + worker;

      this.app.use(function(req, res, next) {
        logger.info('HTTP request %s %s', req.method, req.originalUrl);
        next();
      });

      this.app.get(basePath + '/test', function(req, res) {
        logger.info('Test is successful');
        res.send('Test is successful');
      });

      this.app.get(basePath + '/', function(req, res) {
        logger.info('Load-balancer health check');
        res.send('Node server is healthy');
      });

      this.app.post(basePath + '/event', jsonParser, function(req, res) {
        ringInterface.eventProcessor(req, res);
      });

      this.app.listen(ringLocalPort, function() {
        logger.info('Ring events server is listening on port %s',
          ringLocalPort);
        logger.info('Base path is: %s', basePath);
      });
    }
  }
  return new RingEventsServer(polyInterface); // Module returns a singleton
};
