package org.tilecast.player.content

object PresentationCapabilities {
    val schemas = org.tilecast.player.network.PlayerPresentationSupport.schemas
    val native = org.tilecast.player.network.PlayerPresentationSupport.native
    const val webRuntimeVersion = org.tilecast.player.network.PlayerPresentationSupport.webRuntimeVersion
    const val webBundleLimitBytes = org.tilecast.player.network.PlayerPresentationSupport.webBundleLimitBytes
}
