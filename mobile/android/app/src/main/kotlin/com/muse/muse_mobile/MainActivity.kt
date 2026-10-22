package com.muse.muse_mobile

import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.ryanheise.audioservice.AudioServiceActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Small bridge for alarm reliability: read the system switches that decide
 * whether Bip's alarms can ring, and open the right settings page for each,
 * including Xiaomi/HyperOS's own permission screens (Autostart, lock screen).
 */
class MainActivity : AudioServiceActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "muse/system").setMethodCallHandler { call, result ->
            when (call.method) {
                "manufacturer" -> result.success(Build.MANUFACTURER.lowercase())
                "canUseFullScreenIntent" -> result.success(canUseFullScreenIntent())
                "isIgnoringBatteryOptimizations" -> {
                    val power = getSystemService(Context.POWER_SERVICE) as PowerManager
                    result.success(power.isIgnoringBatteryOptimizations(packageName))
                }
                "openFullScreenIntentSettings" -> result.success(
                    if (Build.VERSION.SDK_INT >= 34) open(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, packageUri())) else openAppDetails()
                )
                "requestIgnoreBatteryOptimizations" -> result.success(
                    open(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, packageUri())) || openAppDetails()
                )
                "openXiaomiPermissions" -> result.success(openXiaomiPermissions() || openAppDetails())
                "openXiaomiAutostart" -> result.success(
                    open(Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")))
                        || openXiaomiPermissions() || openAppDetails()
                )
                "openNotificationSettings" -> result.success(
                    open(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)) || openAppDetails()
                )
                "openAppDetails" -> result.success(openAppDetails())
                else -> result.notImplemented()
            }
        }
    }

    private fun canUseFullScreenIntent(): Boolean {
        if (Build.VERSION.SDK_INT < 34) return true
        return (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).canUseFullScreenIntent()
    }

    private fun packageUri() = Uri.parse("package:$packageName")

    private fun openAppDetails() = open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri()))

    // HyperOS/MIUI "Other permissions" page: lock screen, background pop-ups.
    private fun openXiaomiPermissions() = open(
        Intent("miui.intent.action.APP_PERM_EDITOR")
            .setClassName("com.miui.securitycenter", "com.miui.permcenter.permissions.PermissionsEditorActivity")
            .putExtra("extra_pkgname", packageName)
    )

    private fun open(intent: Intent): Boolean = try {
        startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (e: Exception) {
        false
    }
}
