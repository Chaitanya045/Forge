from __future__ import annotations

from math import ceil

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

        bars = cls.VERTICAL_BARS if vertical else cls.HORIZONTAL_BARS
        bars_count = len(bars)
        width_thickness = thickness if vertical else 1
        blank = cls.BLANK_GLYPH * width_thickness
        grab_meta = {"@mouse.down": "grab"}

        if (
            window_size
            and size
            and virtual_size
            and size != virtual_size
            and virtual_size > window_size
        ):
            bar_ratio = virtual_size / size
            thumb_size = max(1, window_size / bar_ratio)

            position_ratio = position / (virtual_size - window_size)
            thumb_position = (size - thumb_size) * position_ratio

            start = int(thumb_position * bars_count)
            end = start + ceil(thumb_size * bars_count)

            start_index, start_bar = divmod(max(0, start), bars_count)
            end_index, end_bar = divmod(max(0, end), bars_count)

            move_prev = {"@mouse.up": "scroll_up" if vertical else "scroll_left"}
            move_next = {"@mouse.up": "scroll_down" if vertical else "scroll_right"}

            prev_segment = Segment(blank, Style(bgcolor=back_color, meta=move_prev))
            next_segment = Segment(blank, Style(bgcolor=back_color, meta=move_next))
            thumb_segment = Segment(blank, Style(bgcolor=bar_color, meta=grab_meta))

            segments = [prev_segment] * int(size)
            segments[end_index:] = [next_segment] * (size - end_index)
            segments[start_index:end_index] = [thumb_segment] * (
                end_index - start_index
            )

            if start_index < len(segments):
                head_character = bars[bars_count - 1 - start_bar]
                if head_character != " ":
                    segments[start_index] = Segment(
                        head_character * width_thickness,
                        Style(bgcolor=back_color, color=bar_color, meta=grab_meta)
                        if vertical
                        else Style(
                            bgcolor=back_color,
                            color=bar_color,
                            meta=grab_meta,
                            reverse=True,
                        ),
                    )

            if end_index < len(segments):
                tail_character = bars[bars_count - 1 - end_bar]
                if tail_character != " ":
                    segments[end_index] = Segment(
                        tail_character * width_thickness,
                        Style(
                            bgcolor=back_color,
                            color=bar_color,
                            meta=grab_meta,
                            reverse=True,
                        )
                        if vertical
                        else Style(bgcolor=back_color, color=bar_color, meta=grab_meta),
                    )
        else:
            segments = [Segment(blank, Style(bgcolor=back_color))] * int(size)

        if vertical:
            return Segments(segments, new_lines=True)

        return Segments((segments + [Segment.line()]) * thickness, new_lines=False)
