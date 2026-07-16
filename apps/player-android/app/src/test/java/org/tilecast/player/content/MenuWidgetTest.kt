package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Test

class MenuWidgetTest {
    @Test fun humanizesCommonLunchFields() {
        assertEquals("Entrée", menuFieldLabel("option_1"))
        assertEquals("Alternative", menuFieldLabel("option_2"))
        assertEquals("Side Dish", menuFieldLabel("side_dish"))
    }
}
