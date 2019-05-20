'use strict';

// Contains the oAuth logic & Ring API calls

const request = require('request-promise-native');

const ringAuthorizationUrl = 'https://oauth.ring.com/oauth/authorize';
const ringTokenUrl = 'https://oauth.ring.com/oauth/token';
const ringRevokeUrl = 'https://oauth.ring.com/oauth/revoke';
const ringApiBaseUrl = 'https://api.ring.com/integrations_api';
const authNoticeKey = 'auth'; // The notice key for the Authorization link

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

    getOaParams() {
      const config = polyInterface.getConfig();
      const stage = polyInterface.getStage();
      return config.oauth[stage];
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
        logger.info('Sending auth notice message go3');
        // Add a notice in the UI
        const authUrl = ringAuthorizationUrl +
          '?response_type=code' +
          '&client_id=' + oaParams.clientId +
          '&redirect_uri=' + oaParams.redirectUrl +
          '&state=' + state +
          '&scope=read';

        const authMessage = 'Please click <a href="' + authUrl +
          '" target="_blank">here</a> to authorize access to your Ring account';

        this.polyInterface.addNotice(authNoticeKey, authMessage);
        logger.info('Sending auth notice message');
      } else {
        logger.info('auth notice message is already there');
      }
    }

    async sendAuthNoticeMessageDelayed() {
      try {
        await delay(3000);
        this.sendAuthNoticeMessage();
      } catch (err) {
        logger.errorStack(err, 'Error sending authorization notice message:');
      }
    }

    // Removes the authorization notice when successfully authorized
    removeAuthNoticeMessage() {
      this.polyInterface.removeNotice(authNoticeKey);
      this.authCodeExpected = false;
      logger.info('Removed auth notice message');
    }

    // Triggered after user has authorized
    async processAuthCode(code, state) {
      const _this = this;
      const config = this.polyInterface.getConfig();

      if (state !== config.worker) {
        logger.error(
          'Received invalid authorization. Received state: %s, worker is %s',
          state, config.worker);
      } else if (!this.authCodeExpected) {
        logger.error('Received unexpected authorization code');
        this.removeAuthNoticeMessage(); // In case the notice is still there
      } else {
        const oaParams = this.getOaParams();

        return request({
          method: 'POST',
          url: ringTokenUrl,
          json: true,
          gzip: true,
          // headers: teslaApiHeaders,
          form: {
            client_id: oaParams.clientId,
            grant_type: 'authorization_code',
            code: code,
            scope: 'read',
            client_secret: oaParams.secret,
          },
        })
        .then(function(oauth) {
          logger.info('oAuth req result %o', oauth);
          if (_this.oauthIsValid(oauth)) {
            _this.setCreatedAt(oauth);
            _this.saveTokens(oauth);
            // TODO: Trigger sub
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

      return request({
        method: 'POST',
        url: ringTokenUrl,
        json: true,
        gzip: true,
        form: {
          grant_type: 'refresh_token',
          client_id: oaParams.clientId,
          client_secret: oaParams.secret,
          refresh_token: oauth.refresh_token,
        },
      })
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
        return request({
          method: 'POST',
          url: ringRevokeUrl,
          auth: {
            bearer: oauth.access_token,
          },
        })
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
        oauth.created_at = new Date().valueOf() / 1000 - 10; // 10 secs earlier
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

      if (!newTokens && oauth) {
        logger.info('Reusing existing tokens');
      }

      // logger.info('existing oauth: %o', oauth);
      return oauth && oauth.access_token ? oauth.access_token : null;
    }

    async callApi(method, url, body, forceRefresh = false) {
      logger.info('Ring API: %s', url);

      try {
        const accessToken = await this.getAccessToken(forceRefresh);

        if (accessToken) {
          let req = {
            method: method,
            auth: {
              bearer: accessToken,
              // + (forceRefresh ? '1' : '1'), TESTING
            },
            // headers: teslaApiHeaders,
            url: ringApiBaseUrl + url,
            json: true,
            gzip: true,
          };

          if (body) {
            req.body = body;
          }

          const result = await request(req);

          // If not successful
          // if (result && result.response && 'result' in result.response) {
          //   if (!result.response.result) {
          //     logger.info('Ring API result for %s%s: %o',
          //       url,
          //       body ? ' ' + JSON.stringify(body) : '',
          //       result.response.reason ? result.response.reason : result);
          //   }
          // }

          return result;
        } else {
          logger.error('Ring API %s cancelled', url);
          throw Error('Authorization by user is required');
        }
      } catch (err) {
        if (err.statusCode === 401 && !forceRefresh) {
          // Retry it, but get a new accessToken first
          logger.info('Ring API returned %s, will retry with new tokens',
            err.statusCode);
          return this.callApi(method, url, body, true);
        } else {
          logger.error('Ring API %s returned: %s', url, err.message);
          // logger.errorStack(err, 'Error processing Ring API:');
          throw err;
        }
      }
    }

    async callApiGet(url) {
      return this.callApi('GET', url);
    }

    async callApiPost(url, body) {
      return this.callApi('POST', url, body);
    }

    async callApiDelete(url, body) {
      return this.callApi('DELETE', url);
    }

    async getUser() {
      return await this.callApiGet('/user/info');
    }

    async getDevices() {
      return await this.callApiGet('/devices');
    }

    async getDoorbellData(id) {
      const devices = await this.callApiGet('/devices');
      const doorbells = devices.doorbells;

      id = parseInt(id, 10);
      const doorbellsFound = doorbells.filter(function(doorbell) {
        return parseInt(doorbell.id, 10) === id;
      });

      return doorbellsFound.length ? doorbellsFound[0] : null;
    }
  }

  return new RingInterface(polyInterface); // Module returns a singleton
};
