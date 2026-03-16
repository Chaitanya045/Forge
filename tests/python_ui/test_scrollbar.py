from __future__ import annotations

from rich.color import Color

from zace_tui.ui.scrollbar import RoundedGlassScrollBarRender


def _thumb_length(segments, bar_color: Color) -> int:
    return sum(
        1
        for segment in segments.segments
        if segment.style is not None and segment.style.bgcolor == bar_color
    )


def _thumb_signature(segments, bar_color: Color) -> str:
    cells: list[str] = []
    for segment in segments.segments:
        style = segment.style
        if style is None:
            cells.append(".")
            continue
        if style.bgcolor == bar_color or style.color == bar_color:
            cells.append(segment.text)
            continue
        cells.append(".")
    return "".join(cells)


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


def test_render_bar_has_smooth_fractional_progression() -> None:
    bar_color = Color.parse("#66D9EF")
    back_color = Color.parse("#000000")

    signatures = {
        _thumb_signature(
            RoundedGlassScrollBarRender.render_bar(
                size=12,
                virtual_size=240,
                window_size=24,
                position=position,
                bar_color=bar_color,
                back_color=back_color,
            ),
            bar_color,
        )
        for position in range(0, 41)
    }

    assert len(signatures) >= 10
