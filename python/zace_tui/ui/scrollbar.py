from __future__ import annotations

from rich.color import Color
from rich.segment import Segment, Segments
from rich.style import Style
from textual.scrollbar import ScrollBarRender


class RoundedGlassScrollBarRender(ScrollBarRender):
    @classmethod
    def render_bar(
        cls,
        size: int = 25,
        virtual_size: float = 50,
        window_size: float = 20,
        position: float = 0,
        thickness: int = 1,
        vertical: bool = True,
        back_color: Color = Color.parse("#555555"),
        bar_color: Color = Color.parse("bright_magenta"),
    ) -> Segments:
        if size <= 0:
            return Segments([], new_lines=vertical)

        if window_size > virtual_size:
            window_size, virtual_size = virtual_size, window_size

        width_thickness = thickness if vertical else 1
        blank = cls.BLANK_GLYPH * width_thickness
        base_style = Style(bgcolor=back_color)

        if not window_size or not virtual_size:
            segments = [Segment(blank, base_style)] * size
        elif virtual_size <= window_size:
            segments = [Segment(blank, base_style)] * size
        else:
            thumb_size = max(1, round(size * window_size / virtual_size))
            thumb_size = min(size, thumb_size)

            virtual_scroll_range = max(virtual_size - window_size, 1)
            position_ratio = max(0.0, min(1.0, position / virtual_scroll_range))
            thumb_start = int((size - thumb_size) * position_ratio)
            thumb_start = max(0, min(size - 1, thumb_start))
            thumb_end = max(thumb_start + 1, min(size, thumb_start + thumb_size))

            move_prev = {"@mouse.up": "scroll_up" if vertical else "scroll_left"}
            move_next = {"@mouse.up": "scroll_down" if vertical else "scroll_right"}
            grab_meta = {"@mouse.down": "grab"}

            prev_bg_style = Style(bgcolor=back_color, meta=move_prev)
            next_bg_style = Style(bgcolor=back_color, meta=move_next)
            thumb_style = Style(bgcolor=bar_color, meta=grab_meta)

            segments = [Segment(blank, prev_bg_style)] * size
            segments[thumb_end:] = [Segment(blank, next_bg_style)] * (size - thumb_end)

            for index in range(thumb_start, thumb_end):
                segments[index] = Segment(blank, thumb_style)

        if vertical:
            return Segments(segments, new_lines=True)

        return Segments((segments + [Segment.line()]) * thickness, new_lines=False)
