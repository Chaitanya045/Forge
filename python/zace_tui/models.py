from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field


class ZaceUiModel(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)


class BridgePromptOption(ZaceUiModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)


class BridgeState(ZaceUiModel):
    activeToolName: str | None = None
    hasPendingApproval: bool | None = None
    hasPendingPermission: bool | None = None
    isBusy: bool | None = None
    runState: str | None = None
    sessionFilePath: str | None = None
    sessionId: str | None = None
    stepLabel: str | None = None
    turnCount: int | None = None


class ChatMessageEvent(ZaceUiModel):
    activityId: str | None = None
    chunk: Literal["delta", "end", "start"] | None = None
    finalState: str | None = None
    kind: Literal["message", "reasoning", "tool_activity"] | None = None
    role: Literal["assistant", "system", "user"]
    status: Literal["completed", "error", "running"] | None = None
    streamId: str | None = None
    subtitle: str | None = None
    text: str
    timestamp: int
    toolName: str | None = None
    type: Literal["chat_message"] = "chat_message"


class StateUpdateEvent(ZaceUiModel):
    state: BridgeState
    type: Literal["state_update"] = "state_update"


class ToolStatusEvent(ZaceUiModel):
    attempt: int | None = None
    status: Literal["finished", "started"]
    step: int | None = None
    success: bool | None = None
    toolName: str
    type: Literal["tool_status"] = "tool_status"


class ToolActivityEvent(ZaceUiModel):
    activityId: str = Field(min_length=1)
    attempt: int
    status: Literal["completed", "error", "running"]
    step: int
    subtitle: str | None = None
    text: str
    timestamp: int
    toolName: str
    type: Literal["tool_activity"] = "tool_activity"


class ApprovalPromptEvent(ZaceUiModel):
    command: str
    options: list[BridgePromptOption]
    prompt: str
    reason: str
    type: Literal["approval_prompt"] = "approval_prompt"


class PermissionPromptEvent(ZaceUiModel):
    options: list[BridgePromptOption]
    patterns: list[str]
    permission: str
    prompt: str
    type: Literal["permission_prompt"] = "permission_prompt"


class ErrorEvent(ZaceUiModel):
    message: str
    type: Literal["error"] = "error"


BridgeEvent = Union[
    ApprovalPromptEvent,
    ChatMessageEvent,
    ErrorEvent,
    PermissionPromptEvent,
    StateUpdateEvent,
    ToolActivityEvent,
    ToolStatusEvent,
]


class BridgeInitPayload(ZaceUiModel):
    session_file_path: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    ui_config: dict[str, Any] = Field(default_factory=dict)
