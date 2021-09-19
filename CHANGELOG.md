# Change Log

v1.4.2
Added support for new floodlights (kind "cocoa_floodlight")

v1.4.1
Fixed bug with axios request

v1.4.0
changed module request to axios
Removed logging chatter

v1.3.0
Automatically convert Doorbell and Camera nodes from mV to Percent. Programs may need to be re-saved.
Automatically send new profile files if changed.

v1.2.0
Change Ring API endpoint to /integrations/v1
Battery life may be missing from the device if offline or if device is wired. In this case, it defaults to 100%

v1.1.4
Battery life is always reported to ISY on every short polls

v1.1.3
Added handling of load balancer health checks (GET /)

v1.1.2
Added lighting capability for cams which has kind 'floodlight_v2'

v1.1.1
Removed logging of the config

v1.1.0
Added support for Camera motions (ALPHA release)
Events are now received using HTTPS

v1.0.0
Initial release


