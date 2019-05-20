'use strict';

// Contains the web server to handle Ring events such as Ding and motion

const express = require('express');
const bodyParser = require('body-parser');
const jsonParser = bodyParser.json();
const ringLocalPort = 3000;

// Polyglot is the PGC module (Does not support Polyglot-V2 due to oAuth
// polyInterface is the instantiated Polyglot interface module
module.exports = function(Polyglot, polyInterface) {
  const logger = Polyglot.logger;

  class RingEventsServer {

    constructor(polyInterface) {
      this.polyInterface = polyInterface;
      this.app = express();

      this.app.use(function(req, res, next) {
        logger.info('HTTP request %s %s', req.method, req.originalUrl);
        next();
      });

      this.app.post('/event', jsonParser, function(req, res) {
        logger.info('Event received: %o', req.body['test']);
        res.send('Hello World');
      });

      this.app.listen(ringLocalPort, function() {
        logger.info('Ring events server is listening on port %s',
          ringLocalPort);
      });
    }
  }
  return new RingEventsServer(polyInterface); // Module returns a singleton
};
