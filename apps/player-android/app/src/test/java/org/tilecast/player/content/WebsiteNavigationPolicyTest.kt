package org.tilecast.player.content
import org.junit.Assert.*
import org.junit.Test
import org.tilecast.player.network.ManifestWebsite
class WebsiteNavigationPolicyTest{private val site=ManifestWebsite("a","Site","https://example.com/start",listOf("example.com","cdn.example.com"),true,true,"first_party","on_each_activation",null,20,100,0,0,"","#13231E","placeholder")
 @Test fun allowsOnlyExactApprovedTopLevelHosts(){assertTrue(WebsiteNavigationPolicy.allows("https://example.com/next",site));assertTrue(WebsiteNavigationPolicy.allows("https://cdn.example.com/page",site));assertFalse(WebsiteNavigationPolicy.allows("https://evil.example.com",site));assertFalse(WebsiteNavigationPolicy.allows("javascript:alert(1)",site));assertFalse(WebsiteNavigationPolicy.allows("https://user:pass@example.com",site));assertFalse(WebsiteNavigationPolicy.allows("https://example.com:8443",site))}
}
