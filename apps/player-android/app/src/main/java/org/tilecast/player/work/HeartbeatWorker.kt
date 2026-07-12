package org.tilecast.player.work

import android.content.Context
import android.os.SystemClock
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.tilecast.player.BuildConfig
import org.tilecast.player.data.PlayerDatabase
import org.tilecast.player.network.ApiException
import org.tilecast.player.network.HeartbeatRequest
import org.tilecast.player.network.TilecastApi
import org.tilecast.player.security.KeystoreCredentialStore

class HeartbeatWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val config = PlayerDatabase.get(applicationContext).configuration().get() ?: return Result.success()
        val server = config.serverUrl ?: return Result.success()
        val metrics = applicationContext.resources.displayMetrics
        return try {
            val api = TilecastApi()
            val identity = api.identity(server)
            if (identity.installationId != config.serverInstallationId) return Result.failure()
            val credential = KeystoreCredentialStore(applicationContext).read() ?: return Result.success()
            api.heartbeat(server, credential, HeartbeatRequest(metrics.widthPixels, metrics.heightPixels, applicationContext.filesDir.usableSpace, SystemClock.elapsedRealtime() / 1000, BuildConfig.VERSION_NAME))
            Result.success()
        } catch (error: ApiException) {
            if (error.code == "device_credential_revoked") KeystoreCredentialStore(applicationContext).clear()
            if (error.status in 400..499) Result.failure() else Result.retry()
        } catch (_: Exception) { Result.retry() }
    }
}
