from __future__ import annotations

from rich.color import Color

from zace_tui.ui.scrollbar import RoundedGlassScrollBarRender


def _thumb_length(segments, bar_color: Color) -> int:
    return sum(
        1
        for segment in segments.segments
        if segment.style is not None
        and (segment.style.bgcolor == bar_color or segment.style.color == bar_color)
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


def _thumb_start_index(segments, bar_color: Color) -> int | None:
    for index, segment in enumerate(segments.segments):
        style = segment.style
        if style is None:
            continue
        if style.bgcolor == bar_color or style.color == bar_color:
            return index
    return None


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


def test_render_bar_thumb_moves_smoothly_down_track() -> None:
    bar_color = Color.parse("#66D9EF")
    back_color = Color.parse("#000000")

    start_indexes: list[int] = []
    for position in range(0, 41):
        rendered = RoundedGlassScrollBarRender.render_bar(
            size=12,
            virtual_size=240,
            window_size=24,
            position=position,
            bar_color=bar_color,
            back_color=back_color,
        )
        start_index = _thumb_start_index(rendered, bar_color)
        assert start_index is not None
        start_indexes.append(start_index)

    assert start_indexes == sorted(start_indexes)
    assert max(start_indexes) > min(start_indexes)


def test_render_bar_uses_plain_line_caps_for_thumb_edges() -> None:
    bar_color = Color.parse("#66D9EF")
    back_color = Color.parse("#000000")

    top_signature = _thumb_signature(
        RoundedGlassScrollBarRender.render_bar(
            size=12,
            virtual_size=240,
            window_size=24,
            position=0,
            bar_color=bar_color,
            back_color=back_color,
        ),
        bar_color,
    )
    bottom_signature = _thumb_signature(
        RoundedGlassScrollBarRender.render_bar(
            size=12,
            virtual_size=240,
            window_size=24,
            position=240,
            bar_color=bar_color,
            back_color=back_color,
        ),
        bar_color,
    )

    assert "│" in top_signature
    assert "│" in bottom_signature


def test_render_bar_uses_ultra_thin_thumb_glyph() -> None:
    bar_color = Color.parse("#66D9EF")
    back_color = Color.parse("#000000")

    signature = _thumb_signature(
        RoundedGlassScrollBarRender.render_bar(
            size=12,
            virtual_size=240,
            window_size=24,
            position=17,
            bar_color=bar_color,
            back_color=back_color,
            vertical=True,
        ),
        bar_color,
    )

    assert "│" in signature
