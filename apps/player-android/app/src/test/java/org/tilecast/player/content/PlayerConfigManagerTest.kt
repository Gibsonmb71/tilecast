package org.tilecast.player.content

import org.junit.Test
import org.tilecast.player.network.PlayerCachePolicy
import org.tilecast.player.network.PlayerConfig

class PlayerConfigManagerTest {
    @Test fun validatesSafeConfiguration(){PlayerConfigValidator.validate(PlayerConfig(1,2,"2026-07-12T18:00:00Z"))}
    @Test(expected=IllegalArgumentException::class) fun rejectsUnsafeReportingInterval(){PlayerConfigValidator.validate(PlayerConfig(1,2,"2026-07-12T18:00:00Z",cache=PlayerCachePolicy(concurrentDownloads=20)))}
}
