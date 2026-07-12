package org.tilecast.player.content

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.tilecast.player.network.PlayerCommand
import org.tilecast.player.network.TilecastApi
import java.time.Instant

data class CommandOutcome(val success:Boolean,val code:String,val message:String)

class CommandCoordinator(private val context:Context,private val api:TilecastApi){
    private val store=context.getSharedPreferences("tilecast-commands",Context.MODE_PRIVATE)
    val playbackDisabled:Boolean get()=store.getBoolean("playback-disabled",false)
    suspend fun fetchAndRun(server:String,credential:String,handler:suspend(PlayerCommand)->CommandOutcome){
        api.commands(server,credential).items.forEach{command->
            if(store.getBoolean("done-${command.idempotencyKey}",false)){
                api.commandResult(server,credential,command.id,true,"command_already_applied","Command was already applied by this player")
                return@forEach
            }
            if(!Instant.now().isBefore(Instant.parse(command.expiresAt)))return@forEach
            api.acknowledgeCommand(server,credential,command.id)
            val outcome=runCatching{handler(command)}.getOrElse{CommandOutcome(false,"command_failed","The player could not complete the command")}
            if(outcome.success){withContext(Dispatchers.IO){store.edit().putBoolean("done-${command.idempotencyKey}",true).apply()}}
            api.commandResult(server,credential,command.id,outcome.success,outcome.code,outcome.message)
        }
    }
    fun setPlaybackDisabled(value:Boolean){store.edit().putBoolean("playback-disabled",value).apply()}
}
