from __future__ import annotations

from rich.color import Color

from zace_tui.ui.scrollbar import RoundedGlassScrollBarRender


def _thumb_length(segments, bar_color: Color) -> int:
    return sum(
        1
        for segment in segments.segments
        if segment.style is not None and segment.style.bgcolor == bar_color
    )


def test_render_bar_thumb_sizes() -> None:
    bar_color = Color.parse("#FF00FF")
    back_color = Color.parse("#000000")

    overflow = RoundedGlassScrollBarRender.render_bar(
        size=10,
        virtual_size=100,
        window_size=20,
        bar_color=bar_color,
        back_color=back_color,
    )
    overflow_thumb = _thumb_length(overflow, bar_color)
    assert 0 < overflow_thumb < 10

    swapped = RoundedGlassScrollBarRender.render_bar(
        size=10,
        virtual_size=20,
        window_size=100,
        bar_color=bar_color,
        back_color=back_color,
    )
    assert _thumb_length(swapped, bar_color) == overflow_thumb

    no_overflow = RoundedGlassScrollBarRender.render_bar(
        size=10,
        virtual_size=20,
        window_size=20,
        bar_color=bar_color,
        back_color=back_color,
    )
    assert _thumb_length(no_overflow, bar_color) == 0
