package org.tilecast.player.content

import android.app.Application
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.jsonPrimitive
import org.tilecast.player.BuildConfig
import org.tilecast.player.UpdateInstallReceiver
import org.tilecast.player.network.PlayerCommand
import org.tilecast.player.network.PlayerUpdateMetadata
import org.tilecast.player.network.TilecastApi
import java.io.File
import java.security.MessageDigest
import java.time.Instant

data class UpdateUiState(val deploymentId:String,val currentVersion:String,val newVersion:String,val state:String,val downloadedBytes:Long,val expectedBytes:Long,val message:String,val permissionRequired:Boolean=false,val installReady:Boolean=false,val maintenanceAt:String?=null,val errorCode:String?=null)
data class ArchiveMetadata(val applicationId:String,val versionCode:Long,val certificateSha256:String)

object PlayerUpdateVerifier {
    fun validate(remote:PlayerUpdateMetadata,currentVersionCode:Long,sdk:Int,archive:ArchiveMetadata,installedCertificateSha256:String){
        require(remote.applicationId==BuildConfig.APPLICATION_ID && archive.applicationId==BuildConfig.APPLICATION_ID){"package_name_mismatch"}
        require(remote.versionCode>currentVersionCode && archive.versionCode==remote.versionCode){"version_downgrade_or_mismatch"}
        require(remote.minimumSdk<=sdk){"device_incompatible"}
        require(archive.certificateSha256.equals(remote.signingCertificateSha256,true)){"certificate_mismatch"}
        require(archive.certificateSha256.equals(installedCertificateSha256,true)){"installed_certificate_mismatch"}
    }
}

class PlayerUpdateManager(private val app:Application,private val api:TilecastApi){
    private val store=app.getSharedPreferences("tilecast-player-updates",Application.MODE_PRIVATE)
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.Default)
    private var maintenanceJob:Job?=null
    val restored:UpdateUiState? get()=store.getString("deployment",null)?.let{deployment->val next=store.getString("new-version","")?:"";if(next==BuildConfig.VERSION_NAME){store.edit().clear().apply();null}else UpdateUiState(deployment,BuildConfig.VERSION_NAME,next,store.getString("state","pending")?:"pending",store.getLong("downloaded",0),store.getLong("expected",0),"Player update is ready to continue",store.getBoolean("permission",false),store.getBoolean("ready",false),store.getString("maintenance-at",null),store.getString("error-code",null))}

    suspend fun prepare(server:String,credential:String,command:PlayerCommand,emergencyActive:()->Boolean,onState:(UpdateUiState)->Unit):CommandOutcome{
        val deployment=command.payload["deploymentId"]?.jsonPrimitive?.contentOrNull?:return CommandOutcome(false,"update_payload_invalid","Update deployment is invalid")
        val release=command.payload["releaseId"]?.jsonPrimitive?.contentOrNull?:return CommandOutcome(false,"update_payload_invalid","Update release is invalid")
        val expected=command.payload["expectedVersionCode"]?.jsonPrimitive?.longOrNull?:return CommandOutcome(false,"update_payload_invalid","Expected version is invalid")
        if(expected<=BuildConfig.VERSION_CODE)return CommandOutcome(true,"update_already_current","Player is already current")
        return try{
            val metadata=api.playerUpdate(server,credential,release)
            val part=File(app.filesDir,"updates/$release.apk.part")
            var state=UpdateUiState(deployment,BuildConfig.VERSION_NAME,metadata.versionName,"downloading",part.takeIf{it.exists()}?.length()?:0,metadata.apkSizeBytes,"Downloading player update")
            persist(state);onState(state);api.updateStatus(server,credential,deployment,"downloading",state.downloadedBytes)
            api.downloadVariant(server,metadata.apkPath,credential,part,metadata.apkSha256,metadata.apkSizeBytes){written->state=state.copy(downloadedBytes=written);persist(state);onState(state)}
            state=state.copy(state="verifying",downloadedBytes=metadata.apkSizeBytes,message="Verifying signed player update");persist(state);onState(state);api.updateStatus(server,credential,deployment,"verifying",state.downloadedBytes)
            val archive=inspect(part)
            PlayerUpdateVerifier.validate(metadata,BuildConfig.VERSION_CODE.toLong(),Build.VERSION.SDK_INT,archive,installedCertificateSha256())
            val final=File(part.parentFile,"$release.apk");if(!part.renameTo(final))throw IllegalStateException("update_file_finalize_failed")
            if(command.payload["installationMode"]?.jsonPrimitive?.contentOrNull=="download_only"){
                state=state.copy(state="ready",message="Update downloaded and verified");persist(state);onState(state);api.updateStatus(server,credential,deployment,"ready",state.downloadedBytes);return CommandOutcome(true,"update_downloaded","Player update downloaded and verified")
            }
            val maintenanceAt=command.payload["maintenanceWindowStart"]?.jsonPrimitive?.contentOrNull?.takeIf{it!="null"}
            if(command.payload["installationMode"]?.jsonPrimitive?.contentOrNull=="maintenance_window"&&maintenanceAt!=null&&Instant.parse(maintenanceAt).isAfter(Instant.now())){state=state.copy(state="ready",message="Installation scheduled for ${maintenanceAt}",maintenanceAt=maintenanceAt);persist(state);onState(state);api.updateStatus(server,credential,deployment,"ready",state.downloadedBytes,installerStatus="maintenance_scheduled");scheduleMaintenance(server,credential,state,emergencyActive,onState);return CommandOutcome(true,"update_maintenance_scheduled","Update verified for its maintenance window")}
            if(emergencyActive()){state=state.copy(state="ready",message="Installation delayed by emergency playback",installReady=true);persist(state);onState(state);api.updateStatus(server,credential,deployment,"ready",state.downloadedBytes,installerStatus="delayed_by_emergency");return CommandOutcome(true,"update_ready_emergency_delay","Update verified; installation is delayed by emergency playback")}
            if(Build.VERSION.SDK_INT>=26&&!app.packageManager.canRequestPackageInstalls()){
                state=state.copy(state="waiting_for_permission",message="Allow Tilecast Player to install updates",permissionRequired=true,installReady=true);persist(state);onState(state);api.updateStatus(server,credential,deployment,"waiting_for_permission",state.downloadedBytes,"required");return CommandOutcome(true,"update_waiting_for_permission","Update is waiting for unknown-app permission")
            }
            state=state.copy(state="waiting_for_user",message="Player update is ready to install",installReady=true);persist(state);onState(state);api.updateStatus(server,credential,deployment,"waiting_for_user",state.downloadedBytes,permissionStatus="granted");CommandOutcome(true,"update_waiting_for_user","Update is waiting for TV approval")
        }catch(error:Exception){val code=error.message?.takeIf{it.matches(Regex("[a-z_]+"))}?:"update_preparation_failed";api.updateStatus(server,credential,deployment,"failed",0,error=code);CommandOutcome(false,code,"Player update could not be prepared")}
    }

    fun openPermissionSettings(){app.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${app.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))}
    fun permissionGranted(state:UpdateUiState):UpdateUiState?=if((Build.VERSION.SDK_INT<26||app.packageManager.canRequestPackageInstalls())&&state.permissionRequired){state.copy(state="waiting_for_user",message="Player update is ready to install",permissionRequired=false,installReady=true).also(::persist)}else null
    fun installerFailure(state:UpdateUiState):UpdateUiState?{val result=store.getString("installer-result",null)?:return null;store.edit().remove("installer-result").apply();return if(result=="success")null else state.copy(state="failed",message="Android did not install the update: ${result.replace('_',' ')}",permissionRequired=false,installReady=true,errorCode=result).also(::persist)}
    fun resumeMaintenance(server:String,credential:String,state:UpdateUiState,emergencyActive:()->Boolean,onState:(UpdateUiState)->Unit){if(state.state=="ready"&&state.maintenanceAt!=null)scheduleMaintenance(server,credential,state,emergencyActive,onState)}
    private fun scheduleMaintenance(server:String,credential:String,state:UpdateUiState,emergencyActive:()->Boolean,onState:(UpdateUiState)->Unit){if(maintenanceJob?.isActive==true)return;maintenanceJob=scope.launch{delay(java.time.Duration.between(Instant.now(),Instant.parse(state.maintenanceAt)).toMillis().coerceAtLeast(0));while(emergencyActive()){delay(30_000)};val permissionRequired=Build.VERSION.SDK_INT>=26&&!app.packageManager.canRequestPackageInstalls();val next=state.copy(state=if(permissionRequired)"waiting_for_permission" else "waiting_for_user",message=if(permissionRequired)"Allow Tilecast Player to install updates" else "Player update is ready to install",permissionRequired=permissionRequired,installReady=true);persist(next);onState(next);runCatching{api.updateStatus(server,credential,next.deploymentId,next.state,next.downloadedBytes,if(permissionRequired)"required" else "granted",installerStatus="maintenance_window_reached")}}}
    fun install(state:UpdateUiState):Boolean{
        val releaseFiles=File(app.filesDir,"updates").listFiles()?.filter{it.extension=="apk"}.orEmpty();val apk=releaseFiles.maxByOrNull{it.lastModified()}?:return false
        return runCatching{
            val params=PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply{setAppPackageName(BuildConfig.APPLICATION_ID);setSize(apk.length())}
            val installer=app.packageManager.packageInstaller;val sessionId=installer.createSession(params);installer.openSession(sessionId).use{session->apk.inputStream().use{input->session.openWrite("tilecast-player.apk",0,apk.length()).use{output->input.copyTo(output);session.fsync(output)}};val intent=Intent(app,UpdateInstallReceiver::class.java);val pending=PendingIntent.getBroadcast(app,sessionId,intent,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE);session.commit(pending.intentSender)}
            persist(state.copy(state="installing",message="Android installer is preparing the update"));true
        }.getOrDefault(false)
    }

    @Suppress("DEPRECATION") private fun inspect(file:File):ArchiveMetadata{
        val flags=if(Build.VERSION.SDK_INT>=28)PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val info=app.packageManager.getPackageArchiveInfo(file.absolutePath,flags)?:throw IllegalStateException("package_metadata_invalid")
        val version=if(Build.VERSION.SDK_INT>=28)info.longVersionCode else info.versionCode.toLong()
        val signatures=if(Build.VERSION.SDK_INT>=28)info.signingInfo?.apkContentsSigners else info.signatures
        val certificate=signatures?.firstOrNull()?.toByteArray()?:throw IllegalStateException("certificate_missing")
        return ArchiveMetadata(info.packageName,version,MessageDigest.getInstance("SHA-256").digest(certificate).joinToString(""){"%02x".format(it)})
    }
    @Suppress("DEPRECATION") private fun installedCertificateSha256():String{
        val flags=if(Build.VERSION.SDK_INT>=28)PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val info=app.packageManager.getPackageInfo(BuildConfig.APPLICATION_ID,flags)
        val signatures=if(Build.VERSION.SDK_INT>=28)info.signingInfo?.apkContentsSigners else info.signatures
        val certificate=signatures?.firstOrNull()?.toByteArray()?:throw IllegalStateException("installed_certificate_missing")
        return MessageDigest.getInstance("SHA-256").digest(certificate).joinToString(""){"%02x".format(it)}
    }
    private fun persist(state:UpdateUiState){store.edit().putString("deployment",state.deploymentId).putString("new-version",state.newVersion).putString("state",state.state).putLong("downloaded",state.downloadedBytes).putLong("expected",state.expectedBytes).putBoolean("permission",state.permissionRequired).putBoolean("ready",state.installReady).apply{if(state.maintenanceAt==null)remove("maintenance-at") else putString("maintenance-at",state.maintenanceAt);if(state.errorCode==null)remove("error-code") else putString("error-code",state.errorCode)}.apply()}
}
