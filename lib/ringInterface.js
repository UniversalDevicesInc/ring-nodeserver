'use strict';

// This is the main module to interface with Ring
// Contains the oAuth logic, Ring API calls, and the Ring events processor

const axios = require('axios');
const qs = require('qs');

const ringAuthorizationUrl = 'https://oauth.ring.com/oauth/authorize';
const ringTokenUrl = 'https://oauth.ring.com/oauth/token';
const ringRevokeUrl = 'https://oauth.ring.com/oauth/revoke';
const ringApiHost = 'https://api.ring.com';
const ringApiBasePath = '/integrations/v1';
const authNoticeKey = 'auth'; // The notice key for the Authorization link

// Used for testing only. Subscription don't work with shared devices
const acceptSharedDevices = false;

function delay(delay) {
  return new Promise(function(fulfill) {
    setTimeout(fulfill, delay);
  });
}

// Polyglot is the PGC module (Does not support Polyglot-V2 due to oAuth
// polyInterface is the instantiated Polyglot interface module
module.exports = function(Polyglot, polyInterface) {
  const logger = Polyglot.logger;

  class RingInterface {

    constructor(polyInterface) {
      this.polyInterface = polyInterface;
      this.authCodeExpected = false;
    }

    // Get oauth client Id, secret, redirect URL
    getOaParams() {
      const config = polyInterface.getConfig();
      const stage = polyInterface.getStage();
      const oaParams = config.oauth[stage];

      if (!oaParams) {
        logger.info('Stage: %s', stage);
        logger.info('config.oauth: %o', config.oauth);
        throw Error('Node server store record is not properly configured.' +
          ' It is missing oAuth params for stage: ' + stage);
      }

      return oaParams;
    }

    // Sets PGC notice with a link to allow user to authorize
    // We use this when we have no valid oauth tokens.
    sendAuthNoticeMessage() {
      const oaParams = this.getOaParams();
      const config = this.polyInterface.getConfig();
      const notices = this.polyInterface.getNotices();
      const state = config.worker;

      this.authCodeExpected = true;

      if (!notices[authNoticeKey]) {
        const authUrl = ringAuthorizationUrl +
          '?response_type=code' +
          '&client_id=' + oaParams.clientId +
          '&redirect_uri=' + oaParams.redirectUrl +
          '&state=' + state +
          '&scope=read';

        const authMessage = 'Please click <a href="' + authUrl +
          '" target="_self">here</a> to authorize access to your Ring account';

        // Add a notice in the UI with the link to authorize
        this.polyInterface.addNotice(authNoticeKey, authMessage);
        logger.info('Sending auth notice message');
      } else {
        logger.info('auth notice message is already there');
      }
    }

    // Sends oAuth authentication notice after a certain delay
    async sendAuthNoticeMessageDelayed() {
      try {
        // We do this so that it is not removed when nodeserver is started
        await delay(3000);
        this.sendAuthNoticeMessage();
      } catch (err) {
        logger.errorStack(err, 'Error sending authorization notice message:');
      }
    }

    // Removes notice just in case it's still in the UI
    removeAuthNoticeMessageIfExists() {
      if (this.polyInterface.noticeExists(authNoticeKey)) {
        this.polyInterface.removeNotice(authNoticeKey);
        this.authCodeExpected = false;
        logger.info('Removed auth notice message');
      }
    }

    // Triggered after user has authorized
    async processAuthCode(code, state, controllerAddress) {
      const _this = this;
      const config = this.polyInterface.getConfig();

      if (state !== config.worker) {
        logger.error(
          'Received invalid authorization. Received state: %s, worker is %s',
          state, config.worker);
      } else if (!this.authCodeExpected) {
        logger.error('Received unexpected authorization code');
        this.removeAuthNoticeMessageIfExists(); // In case the notice exists
      } else {
        const oaParams = this.getOaParams();

        return axios({
          method: 'POST',
          url: ringTokenUrl,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          data: qs.stringify({
            client_id: oaParams.clientId,
            grant_type: 'authorization_code',
            code: code,
            scope: 'read',
            client_secret: oaParams.secret,
          })
        })
        .then((response) => response.data)
        .then(function(oauth) {
          // logger.info('oAuth req result %o', oauth);
          if (_this.oauthIsValid(oauth)) {
            _this.setCreatedAt(oauth);
            _this.saveTokens(oauth);
            // _this.subscribe();
            _this.removeAuthNoticeMessageIfExists();

            // Automatically discover nodes.
            const controller = _this.polyInterface.getNode(controllerAddress);
            return controller.onDiscover();
            // Whenever new nodes are created we will receive a new config
            // which will trigger a subscription.
          } else {
            logger.info('Invalid oAuth result %o', oauth);
          }
        });
      }
    }

    // Gets new tokens using refresh token
    async refreshTokens(oauth) {
      // logger.info('refreshTokens %o', oauth);

      const _this = this;
      const oaParams = this.getOaParams();

      return axios({
        method: 'POST',
        url: ringTokenUrl,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        data: qs.stringify({
          grant_type: 'refresh_token',
          client_id: oaParams.clientId,
          client_secret: oaParams.secret,
          refresh_token: oauth.refresh_token,
        })
      })
      .then((response) => response.data)
      .then(function(oauth) {
        logger.info('Refresh result %o', oauth);
        if (_this.oauthIsValid(oauth)) {
          _this.setCreatedAt(oauth);
          _this.saveTokens(oauth);

          // If we had to refresh, continue process with this these new creds
          return oauth;
        }
      });
    }
    // Revoke access
    async revokeTokens(oauth) {
      if (oauth && oauth.access_token) {

        return axios({
          method: 'POST',
          url: ringRevokeUrl,
          headers: { Authorization: `Bearer ${oauth.access_token}` },
        })
        .then((response) => response.data)
        .then(function(result) {
          logger.info('Revoke result %o', result);
        })
        .catch(function(err) {
          logger.error('Access revoke failed: %s', err.message);
        });
      }
    }

    oauthIsValid(oauth) {
      const keys = oauth ? Object.keys(oauth) : [];
      const requiredKeys = ['access_token', 'refresh_token',
        'expires_in', 'token_type'];

      const missingKeys = requiredKeys.filter(function(key) {
        return !keys.includes(key);
      });

      if (missingKeys.length) {
        logger.error('oauth is invalid: %o', oauth);
      }

      return !missingKeys.length;
    }

    // If the oauth provider does not supply a created_at value, create one
    setCreatedAt(oauth) {
      if (!oauth.created_at) {
        // 10 secs earlier than now
        oauth.created_at = Math.floor(new Date().valueOf() / 1000 - 10);
      }
    }

    saveTokens(oauth) {
      if (this.oauthIsValid(oauth)) {
        logger.info('Saving new tokens to customData');

        this.polyInterface.addCustomData({oauth: oauth});
      } else {
        logger.error('Could not save new tokens due to missing keys %o', oauth);
      }
    }

    clearTokens() {
      logger.error('Clearing tokens');
      this.polyInterface.addCustomData({oauth: null});
    }

    // Gets access token from customData, or requests new token if required
    async getAccessToken(forceRefresh = false) {
      const config = this.polyInterface.getConfig();
      // const params = config.customParams;
      let oauth = config.customData.oauth;
      let newTokens = false;

      // logger.info('existing oauth: %o', oauth);
      if (!(oauth && oauth.access_token)) {
        logger.info('New tokens needed - Send Authorization notice');

        this.sendAuthNoticeMessageDelayed();
        oauth = null; // We will return null
      }

      const tokenExpiry = oauth && oauth.created_at && oauth.expires_in ?
        new Date((oauth.created_at + oauth.expires_in) * 1000) : null;

      // Expired or expires in less than 60 seconds?
      if ((tokenExpiry && new Date().valueOf() + 60000 > tokenExpiry.valueOf())
        || forceRefresh) {
        logger.info('Refreshing tokens%s', forceRefresh ? ' [FORCED]' : '');

        try {
          oauth = await this.refreshTokens(oauth);
        } catch (err) {
          if (err.statusCode === 401) {
            // Refresh token not valid? Clear tokens, so that we try with
            // the password grant next time.
            this.clearTokens();
            this.sendAuthNoticeMessageDelayed();
            oauth = null; // We will return null
          }
          throw err;
        }

        // If we successfully refreshed, save new tokens
        this.saveTokens(oauth);
        newTokens = true;
        await delay(2000); // Wait 2 seconds before using new tokens
      }

      // if (!newTokens && oauth) {
      //   logger.info('Reusing existing tokens');
      // }

      // logger.info('existing oauth: %o', oauth);
      return oauth && oauth.access_token ? oauth.access_token : null;
    }

    async callApi(method, url, body, forceRefresh = false) {
      const path = ringApiBasePath + (url[0] !== '/' ? '/' : '') + url;
      const completeUrl = ringApiHost + path;

      logger.info('Ring API: %s %s', method, path);

      try {
        const accessToken = await this.getAccessToken(forceRefresh);

        if (accessToken) {
          const result = await axios({
            method: method,
            url: completeUrl,
            headers: { Authorization: `Bearer ${accessToken}` },
            ...(body && { body: body })
          })
          .then((response) => response.data)

          // If the request worked, auth must be valid. Make sure there's no
          // notice left in the UI.
          this.removeAuthNoticeMessageIfExists();
          return result;
        } else {
          logger.error('Ring API cancelled due to missing authorization: %s',
            path);

          return null;
        }
      } catch (err) {
        if (err.statusCode === 401 && !forceRefresh) {
          // Retry it, but get a new accessToken first
          logger.info('Ring API returned %s, will retry with new tokens',
            err.statusCode);
          return this.callApi(method, url, body, true);
        } else {
          logger.error('Ring API %s returned: %s', path, err.message);
          // logger.errorStack(err, 'Error processing Ring API:');
          throw err;
        }
      }
    }

    async callApiGet(url) {
      return this.callApi('GET', url);
    }

    async callApiPatch(url, body) {
      return this.callApi('PATCH', url, body);
    }

    async callApiDelete(url) {
      return this.callApi('DELETE', url);
    }

    async callApiPut(url, body) {
      return this.callApi('PUT', url, body);
    }

    async getUser() {
      return await this.callApiGet('/user/info');
    }

    filterOwnerDevices(devices, key) {
      const _this = this;
      const countBefore = devices[key].length;
      devices[key] = devices[key].filter(function(d) {
        return d.owner && d.owner.id === _this.userId;
      });
      const countAfter = devices[key].length;

      if (countBefore !== countAfter) {
        logger.info('Devices ignored from devices.%s: ' +
          'Total devices %d valid devices %d',
          key, countBefore, countAfter);
      }
    }

    // Gets only the devices from the owner (Not the shared devices)
    async getOwnerDevices() {
      if (!this.userId) {
        const userInfo = await this.callApiGet('/user/info');
        if (userInfo && userInfo.user && userInfo.user.id) {
          this.userId = userInfo.user.id;
        }
      }

      const devices = await this.getAllDevices();

      try {
        if (devices &&
          !(polyInterface.getStage() === 'test' && acceptSharedDevices)) {

          logger.info('userId %s', this.userId);
          logger.info('Devices %o', devices);

          this.filterOwnerDevices(devices, 'doorbells');
          this.filterOwnerDevices(devices, 'stickup_cams');

          // They are all shared but we process them anyway for testing
          this.filterOwnerDevices(devices, 'authorized_doorbells');
        }

      } catch (err) {
        logger.errorStack(err, 'Error filtering owner devices:');
      }

      return devices;
    }

    async getAllDevices() {
      return await this.callApiGet('/devices');
    }

    // Gets a single device. works for Doorbells or Cams.
    async getDeviceData(id, preFetchedDevices = null) {
      const devices = preFetchedDevices || await this.getAllDevices();

      // If we don't have authorizations, devices will be null
      if (!devices) {
        return null;
      }

      const all = devices.doorbells
      .concat(devices.authorized_doorbells) // They are all shared, for testing
      .concat(devices.stickup_cams);

      id = parseInt(id, 10);
      const found = all.filter(function(d) {
        return parseInt(d.id, 10) === id;
      });

      return found.length ? found[0] : null;
    }

    async subscribe() {
      const config = polyInterface.getConfig();
      const nodesCount = Object.keys(config.nodes).length;

      if (nodesCount >= 2) {
        let baseUrl = config.netInfo.httpsIngress;

        // For testing in dev only
        // if (config.development) {
        //   baseUrl = 'http://publichost/3000/ns/' + config.worker + '/';
        // }

        if (baseUrl) {
          const url = baseUrl + 'event'; // BaseUrl already has a trailing slash

          try {
            logger.info('Starting Subscription with postback URL %s', url);

            // Our inbound events will have this pragma to make sure it's for us
            const pragma = new Date().valueOf().toString();
            const body = {
              subscription: {
                postback_url: url,
                metadata: {
                  headers: {
                    Pragma: pragma,
                  },
                },
              },
            };
            // logger.info('Body: %s', JSON.stringify(body));

            const subResult = await this.callApiPatch('/subscription', body)
            .then((response) => response.data)

            if (subResult === undefined) {
              this.pragma = pragma;
              logger.info('Subscription result: Successful. New pragma is %s',
                this.pragma);
            } else {
              logger.info('Subscription result: %o', subResult);
            }
          } catch (err) {
            logger.errorStack(err, 'Error starting subscription:');
          }
        } else {
          logger.error('Cannot subscribe. Incorrect netInfo: %o',
            config.netInfo);
        }
      } else {
        logger.error('Subscription not required, we have %d nodes', nodesCount);
      }
    }

    async unsubscribe() {
      logger.info('Terminating Subscription');
      try {
        await this.callApiDelete('/subscription');
      } catch (err) {
        logger.error('Error terminating subscription %s', err.message);
      }
    }

    // PUT https://api.ring.com/integrations_api/devices/<dev>/floodlight_off
    async floodlightOff(deviceId) {
      return await this.callApiPut('/devices/' + deviceId + '/floodlight_off');
    }

    async floodlightOn(deviceId) {
      return await this.callApiPut('/devices/' + deviceId + '/floodlight_on');
    }

    // Sample event
    // {
    //   event: 'new-motion',
    //   data: {
    //     user: {
    //       id: 1111111,
    //       name: 'User name'
    //     },
    //     created_at: '2019-01-01T00:00:00Z',
    //     doorbell: {
    //       id: 9999999,
    //       description: 'Front Door'
    //     }
    //   },
    //   id: 99999999999999999
    // }

    // Triggered when we receive events from Ring
    eventProcessor(req, res) {
      // Mapping of ring events to node controls
      const eventData = req.body;
      const controls = [ 'new-ding', 'new-motion' ];
      const pragma = req.headers.pragma;

      logger.info('Event received with Pragma %s: %o', pragma, eventData);

      if (pragma === this.pragma) {
        // Valid event?
        if (controls.includes(eventData.event)) {

          // If it's a motion, find the motion node
          const id = eventData.data.doorbell.id +
            (eventData.event === 'new-motion' ? 'm' : '');

          const node = polyInterface.getNode(id.toString()); // id is 5 digits

          if (node) {
            logger.info('Event received for %s %s: %s',
              id, node.name, eventData.event);

            node.activate();
          } else {
            logger.error('Event for an invalid doorbell %o', eventData);
          }
        } else {
          logger.error('Invalid event received %o', eventData);
        }

        res.status(200).end();
      } else {
        logger.info('Event ignored. Expected pragma %s, received pragma %s',
          this.pragma, pragma);

        res.status(404).end();
      }
    }
  }

  return new RingInterface(polyInterface); // Module returns a singleton
};
