package com.uporpay.wakeorlock;

import android.app.admin.DeviceAdminReceiver;

/**
 * Declared so a device-owner provisioning can name an admin component for
 * setLockTaskPackages(). Without a real DeviceAdminReceiver in the manifest
 * there is no ComponentName to hand the DevicePolicyManager, so the
 * allow-listed lock task (app + dialer, nothing else) is not reachable.
 */
public class AppDeviceReceiver extends DeviceAdminReceiver {
}
