# Making the lockout genuinely inescapable

A side-loaded app — this one included — can pin itself with `startLockTask()`, but Android always
leaves an "Unpin" button in the system UI. That is deliberate: a normal app is never allowed to
hold your phone hostage. If the whole point of the app is that you *cannot* get out, the only
supported way to get there is **device owner**.

Device owner is not a permission you can request from inside an app. It is a provisioning state
granted over adb to a package on a device that has **no accounts on it**, and it is the same
mechanism MDM vendors use.

## What changes once it is device owner

`LockGuard.applyTo()` takes a different branch:

| | side-loaded | device owner |
| --- | --- | --- |
| Home button / Recents | system "Unpin" affordance exits | suppressed inside the lock task |
| Other apps reachable | all of them | only what `setLockTaskPackages()` lists |
| The phone call you are allowed | you can dial anything | only the dialer — so "a normal call still works" is literally true |
| Uninstall / Safe Boot / factory reset | trivial | `DISALLOW_UNINSTALL_APPS`, `DISALLOW_SAFE_BOOT`, `DISALLOW_FACTORY_RESET` |
| Moving the clock back to end a countdown early | free | `DISALLOW_CONFIG_DATE_TIME` while the lockout runs |
| `adb` debugging as an escape route | always on | `DISALLOW_DEBUGGING_FEATURES` (Android 11+) |
| The power button / a hard reboot | works | **still works** — no app, not even a device owner, may block power off. What does not work is *escaping the punishment*: `BootReceiver` reads the deadline back out of storage and the leash re-pins the screen before you have unlocked the phone |
| Settings → App → Clear data | one tap, ledger gone | uninstall is blocked, so the way in is `adb pm clear` — which needs USB debugging, which is blocked while a lockout runs. The remaining honest hole is recovery mode: a factory reset always frees the phone, and it also deletes every alarm you own |

The dialer entry is resolved at runtime through the `<queries>` block in the manifest
(`ACTION_DIAL`), because Android 11+ package visibility means you cannot hardcode
`com.android.dialer` on every ROM.

## Provisioning (wipes the device — read it first)

1. Back everything up. Then factory-reset the phone and get through setup **without adding a
   Google or any other account** (skip Wi-Fi sign-in, skip the account step). Device owner can
   only be set on a device with zero accounts, and it cannot be moved afterwards.
2. Enable **Settings → Developer options → USB debugging**, connect over USB.
3. Install the APK first (`adb install -r wake-or-lock-debug.apk`), then:

```bash
adb shell dpm set-device-owner com.uporpay.wakeorlock/.AppDeviceReceiver
```

Expected output:

```
Success: Device owner set to package ComponentInfo{com.uporpay.wakeorlock/com.uporpay.wakeorlock.AppDeviceReceiver}
```

Common refusals:

- `Not allowed to set the device owner because there are already several users on the device` —
  the device needs a factory reset, or a second user was created.
- `User id must not be system user` / it silently does nothing on some ROMs — several Chinese
  skins strip `dpm`; a Pixel, a Nexus, an emulator or a Samsung device is the reliable path.
- On an **emulator** create it with `-wipe-data -no-snapshot-save` and the command works on a
  fresh AVD in seconds. That is the fastest way to test the whole inescapable loop.

4. Reboot once, open the app, arm an alarm. `Settings → Android engine` should now read
   **Lock enforcement: device owner**.

## Releasing the leash

Device owner is real, so removal is deliberately awkward:

```bash
adb shell dpm remove-active-admin com.uporpay.wakeorlock/.AppDeviceReceiver
```

It only succeeds while the app is **not** in an active lock task — which is the point. If you are
locked out and genuinely need the phone, that is what the panic-release switch is for
(`Settings → The punishment → Panic release`, which costs an extra strike), or another phone, or
the account you can still reach with a dialer.

The nuclear option, which works from recovery and is why this is a personal-discipline tool and not
malware: factory reset the device. The lockout dies with the data.

## What is still not possible

- `DISABLE_KEYGUARD` is deprecated and cannot be used to *lock* the screen for you; the app keeps
  the screen on and covers it instead.
- The volume rockers still control ringer volume (Android does not expose them to apps), so the
  buzz can be silenced — it cannot be dismissed, and the mission timer runs regardless.
- iOS has no equivalent. Guided Access (`Settings → Accessibility → Guided Access`, triple-click)
  is the closest, is manual, and a passcode-holding adult can leave it. Real lockdown on iOS means
  Supervised Mode with an MDM profile, which is not a hobby-project path.
