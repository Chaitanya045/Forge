from __future__ import annotations

from typing import NotRequired, Optional, TypedDict

from rich.align import Align
from rich.padding import Padding
from rich.text import Text


class ChatItem(TypedDict):
    activity_id: NotRequired[str | None]
    final_state: NotRequired[str | None]
    kind: NotRequired[str | None]
    role: str
    status: NotRequired[str | None]
    subtitle: NotRequired[str | None]
    text: str
    tool_name: NotRequired[str | None]


def build_chat_line(
    role: str,
    text: str,
    final_state: str | None,
    edge_padding: int,
    kind: str | None = None,
    status: str | None = None,
    subtitle: str | None = None,
    tool_name: str | None = None,
) -> Align:
    line = Text()
    alignment = "left"
    label_style = "#6A737D"
    label = "system"
    content: Text | Padding = line

    if kind == "reasoning":
        label_style = "#9AA0A6"
        label = "thinking"
    elif kind == "tool_activity":
        label = "tool"
        if status == "running":
            label_style = "#F4B942"
        elif status == "error":
            label_style = "#FF6B6B"
        else:
            label_style = "#58C4A3"
    elif role == "user":
        alignment = "right"
        label_style = "#4EA5FF"
        label = "you"
        line.justify = "right"
    elif role == "assistant":
        label_style = "#2BEE8C"
        label = "agent"

    line.append(label, style=label_style)
    line.append(": ")
    line.append(text)
    if kind == "tool_activity" and subtitle:
        line.append(" - ", style="#6A737D")
        line.append(subtitle, style="#9AA0A6")
    elif kind == "tool_activity" and tool_name:
        line.append(" - ", style="#6A737D")
        line.append(tool_name, style="#9AA0A6")
    if final_state and role != "assistant":
        line.append(f" ({final_state})", style="#88D498")

    if role == "user":
        content = Padding(line, (0, edge_padding, 0, 0))
    else:
        content = Padding(line, (0, 0, 0, edge_padding))

    return Align(content, align=alignment)


def apply_stream_chat_chunk(
    chat_items: list[ChatItem],
    stream_index_by_id: dict[str, int],
    role: str,
    text: str,
    final_state: Optional[str],
    kind: Optional[str],
    stream_id: str,
    chunk: str,
) -> bool:
    if chunk == "start":
        chat_items.append(
            {
                "final_state": None,
                "kind": kind,
                "role": role,
                "status": None,
                "subtitle": None,
                "text": text,
                "tool_name": None,
                "activity_id": None,
            }
        )
        stream_index_by_id[stream_id] = len(chat_items) - 1
        return True

    index = stream_index_by_id.get(stream_id)
    if index is None or index >= len(chat_items):
        chat_items.append(
            {
                "final_state": final_state,
                "kind": kind,
                "role": role,
                "status": None,
                "subtitle": None,
                "text": text,
                "tool_name": None,
                "activity_id": None,
            }
        )
        stream_index_by_id[stream_id] = len(chat_items) - 1
        return True

    if chunk == "delta":
        current_text = chat_items[index].get("text", "") or ""
        chat_items[index]["text"] = f"{current_text}{text}"
        return True

    if chunk == "end":
        if final_state:
            chat_items[index]["final_state"] = final_state
        stream_index_by_id.pop(stream_id, None)
        return True

    return False
