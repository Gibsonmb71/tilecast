package org.tilecast.player.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

@Entity(tableName = "player_configuration")
data class PlayerConfiguration(
    @androidx.room.PrimaryKey val id: Int = 1,
    val playerInstallationId: String,
    val serverUrl: String? = null,
    val serverInstallationId: String? = null,
    val organizationName: String? = null,
    val screenId: String? = null,
    val screenName: String? = null,
)

@Dao
interface PlayerConfigurationDao {
    @Query("SELECT * FROM player_configuration WHERE id=1") suspend fun get(): PlayerConfiguration?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun save(configuration: PlayerConfiguration)
    @Query("UPDATE player_configuration SET screenId=NULL,screenName=NULL WHERE id=1") suspend fun clearPairing()
    @Query("DELETE FROM player_configuration") suspend fun reset()
}

@Database(entities = [PlayerConfiguration::class], version = 1, exportSchema = true)
abstract class PlayerDatabase : RoomDatabase() {
    abstract fun configuration(): PlayerConfigurationDao
    companion object {
        @Volatile private var instance: PlayerDatabase? = null
        fun get(context: Context): PlayerDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context.applicationContext, PlayerDatabase::class.java, "tilecast-player.db").build().also { instance = it }
        }
    }
}

