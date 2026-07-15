package org.tilecast.player.content

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.tilecast.player.network.LayoutDocument
import org.tilecast.player.network.LayoutPlacement

@Composable
fun LayoutPrimitiveCanvas(document: LayoutDocument, modifier: Modifier = Modifier) {
    BoxWithConstraints(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val sourceRatio = document.canvas.width.toFloat() / document.canvas.height
        val targetRatio = maxWidth.value / maxHeight.value
        val width: Dp
        val height: Dp
        if (targetRatio > sourceRatio) {
            height = maxHeight
            width = height * sourceRatio
        } else {
            width = maxWidth
            height = width / sourceRatio
        }
        val sx = width.value / document.canvas.width
        val sy = height.value / document.canvas.height
        Box(Modifier.size(width, height).background(layoutColor(document.canvas.backgroundColor))) {
            document.placements.filter { it.visible && it.type == "primitive" && it.primitive?.kind != "group" }.sortedBy { it.layer }.forEach { placement ->
                PrimitivePlacement(placement, sx, sy)
            }
        }
    }
}

@Composable
private fun PrimitivePlacement(placement: LayoutPlacement, sx: Float, sy: Float) {
    val primitive = placement.primitive ?: return
    val shape = RoundedCornerShape((primitive.cornerRadius * minOf(sx, sy)).dp)
    val box = Modifier.offset((placement.x * sx).dp, (placement.y * sy).dp).size((placement.width * sx).dp, (placement.height * sy).dp).alpha(placement.opacity).clip(shape)
    when (primitive.kind) {
        "text" -> {
            var textModifier = box.background(layoutColor(primitive.backgroundColor))
            if (primitive.borderWidth > 0) textModifier = textModifier.border((primitive.borderWidth * sx).dp, layoutColor(primitive.borderColor), shape)
            Box(
            textModifier.padding((primitive.padding * sx).dp),
            contentAlignment = when (primitive.verticalAlign) { "top" -> Alignment.TopStart; "bottom" -> Alignment.BottomStart; else -> Alignment.CenterStart },
        ) {
            Text(
                text = primitive.text,
                modifier = Modifier.fillMaxSize(),
                color = layoutColor(primitive.color),
                fontSize = (primitive.fontSize * sx).sp,
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight(primitive.fontWeight),
                textAlign = when (primitive.textAlign) { "center" -> TextAlign.Center; "right" -> TextAlign.Right; else -> TextAlign.Left },
                lineHeight = (primitive.fontSize * primitive.lineHeight * sx).sp,
                letterSpacing = (primitive.letterSpacing * sx).sp,
                maxLines = primitive.maximumLines,
                overflow = if (primitive.overflow == "clip") TextOverflow.Clip else TextOverflow.Ellipsis,
            )
        }
        }
        "rectangle" -> Canvas(box) {
            drawRoundRect(layoutColor(primitive.fillColor), cornerRadius = androidx.compose.ui.geometry.CornerRadius(primitive.cornerRadius * sx))
            if (primitive.strokeWidth > 0) drawRoundRect(layoutColor(primitive.strokeColor), cornerRadius = androidx.compose.ui.geometry.CornerRadius(primitive.cornerRadius * sx), style = Stroke(primitive.strokeWidth * sx))
        }
        "circle" -> Canvas(box) {
            drawOval(layoutColor(primitive.fillColor))
            if (primitive.strokeWidth > 0) drawOval(layoutColor(primitive.strokeColor), style = Stroke(primitive.strokeWidth * sx))
        }
        "line" -> Canvas(box) { drawLine(layoutColor(primitive.strokeColor), Offset(0f, size.height / 2), Offset(size.width, size.height / 2), (primitive.strokeWidth * sx).coerceAtLeast(1f)) }
    }
}

internal fun layoutColor(value: String): Color = runCatching { Color(android.graphics.Color.parseColor(value)) }.getOrDefault(Color.Transparent)
