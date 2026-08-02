package org.tilecast.player.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import org.tilecast.player.data.PlayerDatabase
import org.tilecast.player.network.ApiException
import org.tilecast.player.network.BackgroundLivenessApi
import org.tilecast.player.network.ServerIdentity
import org.tilecast.player.network.TilecastApi
import org.tilecast.player.security.KeystoreCredentialStore

internal enum class BackgroundLivenessResult { ACCEPTED, INSTALLATION_MISMATCH }

internal suspend fun sendBackgroundLiveness(
    api: BackgroundLivenessApi,
    serverUrl: String,
    configuredInstallationId: String?,
    credential: String,
): BackgroundLivenessResult {
    val identity: ServerIdentity = api.identity(serverUrl)
    if (identity.installationId != configuredInstallationId) return BackgroundLivenessResult.INSTALLATION_MISMATCH
    api.liveness(serverUrl, credential)
    return BackgroundLivenessResult.ACCEPTED
}

class HeartbeatWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val config = PlayerDatabase.get(applicationContext).configuration().get() ?: return Result.success()
        val server = config.serverUrl ?: return Result.success()
        return try {
            val credential = KeystoreCredentialStore(applicationContext).read() ?: return Result.success()
            when (sendBackgroundLiveness(TilecastApi(), server, config.serverInstallationId, credential)) {
                BackgroundLivenessResult.ACCEPTED -> Result.success()
                BackgroundLivenessResult.INSTALLATION_MISMATCH -> Result.failure()
            }
        } catch (error: ApiException) {
            if (error.code == "device_credential_revoked") KeystoreCredentialStore(applicationContext).clear()
            if (error.status in 400..499) Result.failure() else Result.retry()
        } catch (error: CancellationException) { throw error
        } catch (_: Exception) { Result.retry() }
    }
}
