# Ring Nodeserver

This Nodeserver works with Polyglot cloud only.

### Pre-requisites
1. Own one or more ring doorbells
2. Have your Ring account user ID and password.
3. An [ISY Portal](https://my.isy.io) account, and a [license to access your ISY](https://wiki.universal-devices.com/index.php?title=ISY_Portal_Renewal_Instructions).

NOTE: The Ring account must own the devices. Shared cameras will appear, but no events will be triggered. 

### Nodeserver Installation
Go to [polyglot.isy.io](https://polyglot.isy.io/store), click on Store, and install the Ring Nodeserver.

### Configuration

1. Login to Polyglot and go to your Ring Nodeserver.
2. If you see a blue message with a link to request authentication, click on the link and enter your Ring user and password.
3. You should see a "Ring Controller" node appear in the ISY admin console, and your Ring device(s) underneat. You may need to restart the admin console.
4. Short poll: You can adjust the short poll value which represents how frequent the battery life is refreshed, in seconds.
5. Long poll: This is how often subscription to ring are retried in case it gets lost, in seconds. 
