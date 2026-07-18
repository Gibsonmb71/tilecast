package org.tilecast.player.work

import android.content.Context
import android.os.SystemClock
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
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
            val database = PlayerDatabase.get(applicationContext)
            val active = database.manifests().active()
            val pending = database.manifests().ready()
            val cache = database.cachedAssets().all()
            api.heartbeat(server, credential, HeartbeatRequest(metrics.widthPixels, metrics.heightPixels, applicationContext.filesDir.usableSpace, SystemClock.elapsedRealtime() / 1000, BuildConfig.VERSION_NAME,
                activeManifestVersion = active?.manifestVersion, pendingManifestVersion = pending?.manifestVersion,
                playbackState = if (active != null) "offline-capable" else "idle", downloadQueueCount = cache.count { it.downloadStatus in listOf("queued","downloading") },
                downloadedBytes = cache.sumOf { it.downloadedBytes }, requiredBytes = cache.filter { it.requiredByActiveManifest || it.requiredByPendingManifest }.sumOf { it.expectedFileSize },
                cacheUsedBytes = cache.sumOf { java.io.File(it.localPath).takeIf { file -> file.exists() }?.length() ?: 0 }, cacheLimitBytes = BuildConfig.MEDIA_CACHE_BYTES))
            Result.success()
        } catch (error: ApiException) {
            if (error.code == "device_credential_revoked") KeystoreCredentialStore(applicationContext).clear()
            if (error.status in 400..499) Result.failure() else Result.retry()
        } catch (error: CancellationException) { throw error
        } catch (_: Exception) { Result.retry() }
    }
}
