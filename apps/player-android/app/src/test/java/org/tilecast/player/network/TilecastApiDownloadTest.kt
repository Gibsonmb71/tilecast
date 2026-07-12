package org.tilecast.player.network

import java.io.File
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class TilecastApiDownloadTest {
    @Test fun resumesRangeDownloadAndVerifiesHash() = runTest {
        val content="tilecast".toByteArray();val server=MockWebServer();server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            assertEquals("Bearer credential",request.getHeader("Authorization"));assertEquals("bytes=4-",request.getHeader("Range"));assertEquals("\"sha256-7ac03e565712af76035ca74340408d2b6525fe910a79ea248a6f76a555542dc9\"",request.getHeader("If-Range"));return MockResponse().setResponseCode(206).setHeader("ETag","\"sha256-7ac03e565712af76035ca74340408d2b6525fe910a79ea248a6f76a555542dc9\"").setBody(okio.Buffer().write(content,4,4))}};server.start()
        val part=File.createTempFile("tilecast-download",".part").apply{writeBytes(content.copyOfRange(0,4))};TilecastApi().downloadVariant(server.url("/").toString().removeSuffix("/"),"/asset","credential",part,"7ac03e565712af76035ca74340408d2b6525fe910a79ea248a6f76a555542dc9",8){};assertEquals("tilecast",part.readText());part.delete();server.shutdown()
    }
    @Test fun corruptDownloadIsRemoved() = runTest {val server=MockWebServer();server.enqueue(MockResponse().setBody("corrupt!"));server.start();val part=File.createTempFile("tilecast-corrupt",".part").apply{delete()};runCatching{TilecastApi().downloadVariant(server.url("/").toString().removeSuffix("/"),"/asset","credential",part,"7ac03e565712af76035ca74340408d2b6525fe910a79ea248a6f76a555542dc9",8){}};assertFalse(part.exists());server.shutdown()}
}
