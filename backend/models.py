from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from typing import List
from datetime import datetime

from datetime import date, datetime
from enum import Enum
from typing import Any, Optional
from urllib.parse import urlparse




# Define Pydantic models for backend schema validation

class User(BaseModel):
    userId: str
    settings: dict[str, Any] = {}
    createdAt: datetime

class WindowMetrics(BaseModel):
    focusSeconds: int
    idleSeconds: int

    tabChangeCount: int

    clickCount: int
    keystrokeCount: int
    scrollDelta: int


class TabActivity(BaseModel):
    tabId: int
    windowId: int

    url: str
    domain: str
    title: str

    category: str

    isActive: bool

    focusSeconds: int
    idleSeconds: int

    tabSwitchIn: int
    tabSwitchOut: int

    clickCount: int
    keystrokeCount: int
    scrollDelta: int


class ActivityLog(BaseModel):
    userId: str

    timestamp: datetime

    windowMetrics: WindowMetrics

    tabs: List[TabActivity]

    createdAt: datetime


class UrlCategory(str, Enum):
   SCHOOL = "school"
   WORK = "work"
   PRODUCTIVE = "productive"
   SOCIAL = "social"
   ENTERTAINMENT = "entertainment"
   SHOPPING = "shopping"
   NEWS = "news"
   OTHER = "other"




class TabEventType(str, Enum):
   ACTIVATED = "activated"
   UPDATED = "updated"
   CLOSED = "closed"
   FOCUS_STARTED = "focus_started"
   FOCUS_ENDED = "focus_ended"




class WindowFocusState(str, Enum):
   FOCUSED = "focused"
   UNFOCUSED = "unfocused"




class IdleState(str, Enum):
   ACTIVE = "active"
   IDLE = "idle"
   LOCKED = "locked"


class WindowMetricSummary(BaseModel):
   model_config = ConfigDict(populate_by_name=True)

   active_seconds: int = Field(default=0, ge=0, alias="activeSeconds")
   idle_seconds: int = Field(default=0, ge=0, alias="idleSeconds")
   tab_change_count: int = Field(default=0, ge=0, alias="tabChangeCount")
   click_count: int = Field(default=0, ge=0, alias="clickCount")
   keystroke_count: int = Field(default=0, ge=0, alias="keystrokeCount")
   scroll_delta: int = Field(default=0, alias="scrollDelta")


class TrackedTabSummary(BaseModel):
   model_config = ConfigDict(populate_by_name=True)

   tab_id: int = Field(alias="tabId")
   url: str = Field(alias="Url")
   domain: str = Field(default="", alias="Domain")
   title: Optional[str] = None
   category: UrlCategory = UrlCategory.OTHER
   is_active: bool = Field(default=False, alias="isActive")
   focus_seconds: int = Field(default=0, ge=0, alias="focusSeconds")
   idle_seconds: int = Field(default=0, ge=0, alias="idleSeconds")
   tab_switch_in: int = Field(default=0, ge=0, alias="tabSwitchIn")
   tab_switch_out: int = Field(default=0, ge=0, alias="tabSwitchOut")
   click_count: int = Field(default=0, ge=0, alias="clickCount")
   keystroke_count: int = Field(default=0, ge=0, alias="keystrokeCount")
   scroll_delta: int = Field(default=0, alias="scrollDelta")
   created_at: datetime = Field(default_factory=datetime.utcnow, alias="createdAt")

   @model_validator(mode="after")
   def derive_domain(self):
       if not self.domain and self.url:
           parsed = urlparse(self.url)
           self.domain = parsed.netloc.replace("www.", "")
       return self


class TabSwitchSummary(BaseModel):
   model_config = ConfigDict(populate_by_name=True)

   tab_id: int = Field(alias="tabId")
   url: str
   domain: str = ""
   title: Optional[str] = None
   started_at: datetime = Field(alias="startedAt")
   ended_at: Optional[datetime] = Field(default=None, alias="endedAt")
   duration_seconds: int = Field(default=0, ge=0, alias="durationSeconds")
   clicks: int = Field(default=0, ge=0)
   keystrokes: int = Field(default=0, ge=0, alias="keyStrokes")
   scroll_distance: int = Field(default=0, alias="scrollDistance")

   @model_validator(mode="after")
   def derive_domain(self):
       if not self.domain and self.url:
           parsed = urlparse(self.url)
           self.domain = parsed.netloc.replace("www.", "")
       return self


class ActivityLog(BaseModel):
   model_config = ConfigDict(populate_by_name=True)

   id: Optional[str] = Field(default=None, alias="Id")
   user_id: str = Field(alias="userId")
   timestamp: datetime = Field(default_factory=datetime.utcnow, alias="Timestamp")
   window_metrics: WindowMetricSummary = Field(alias="windowMetrics")
   tabs: list[TrackedTabSummary] = Field(default_factory=list, alias="Tabs")
   tab_switches: list[TabSwitchSummary] = Field(default_factory=list, alias="tabSwitches")


class User(BaseModel):
   model_config = ConfigDict(populate_by_name=True)

   id: Optional[str] = None
   user_id: str
   name: str = Field(alias="Name")
   settings: dict[str, Any] = Field(default_factory=dict)
   focus_url_rules: list[FocusUrlRule] = Field(default_factory=list, alias="focusUrlRules")
   activity_logs: list[ActivityLog] = Field(default_factory=list, alias="activity_logs")




class ActivityEventType(str, Enum):
   CLICK = "click"
   KEYSTROKE = "keystroke"
   SCROLL = "scroll"
   IDLE_STATE_CHANGED = "idle_state_changed"




class TrackedUrl(BaseModel):
   url: str
   domain: str = ""
   title: Optional[str] = None
   category: UrlCategory = UrlCategory.OTHER
   is_focus_url: bool = False


   @model_validator(mode="after")
   def derive_domain(self):
       if not self.domain and self.url:
           parsed = urlparse(self.url)
           self.domain = parsed.netloc.replace("www.", "")
       return self




class FocusUrlRule(BaseModel):
   domain: str
   category: UrlCategory = UrlCategory.PRODUCTIVE
   label: Optional[str] = None
   is_enabled: bool = True
   created_at: datetime = Field(default_factory=datetime.utcnow)


   @field_validator("domain")
   @classmethod
   def normalize_domain(cls, value: str) -> str:
       return value.lower().strip().replace("www.", "")




class TabSession(BaseModel):
   tab_id: int
   window_id: int
   tracked_url: TrackedUrl
   started_at: datetime
   ended_at: Optional[datetime] = None
   duration_seconds: int = Field(default=0, ge=0)




class TabHistoryEvent(BaseModel):
   event_type: TabEventType
   tab_id: int
   window_id: int
   tracked_url: Optional[TrackedUrl] = None
   timestamp: datetime = Field(default_factory=datetime.utcnow)




class WindowFocusEvent(BaseModel):
   window_id: Optional[int] = None
   state: WindowFocusState
   timestamp: datetime = Field(default_factory=datetime.utcnow)




class UserActionEvent(BaseModel):
   event_type: ActivityEventType
   tab_id: Optional[int] = None
   window_id: Optional[int] = None
   url: Optional[str] = None
   domain: Optional[str] = None
   timestamp: datetime = Field(default_factory=datetime.utcnow)
   click_count: int = Field(default=0, ge=0)
   keystroke_count: int = Field(default=0, ge=0)
   scroll_delta: int = 0
   idle_state: Optional[IdleState] = None


   @model_validator(mode="after")
   def derive_domain(self):
       if not self.domain and self.url:
           parsed = urlparse(self.url)
           self.domain = parsed.netloc.replace("www.", "")
       return self




class HourlyUsage(BaseModel):
   day: date
   hour: int = Field(ge=0, le=23)
   domain: Optional[str] = None
   category: UrlCategory = UrlCategory.OTHER
   active_seconds: int = Field(default=0, ge=0)
   click_count: int = Field(default=0, ge=0)
   keystroke_count: int = Field(default=0, ge=0)
   scroll_delta: int = 0




class DailyUsageSummary(BaseModel):
   day: date
   domain: Optional[str] = None
   category: UrlCategory = UrlCategory.OTHER
   active_seconds: int = Field(default=0, ge=0)
   focused_seconds: int = Field(default=0, ge=0)
   idle_seconds: int = Field(default=0, ge=0)
   click_count: int = Field(default=0, ge=0)
   keystroke_count: int = Field(default=0, ge=0)
   scroll_delta: int = 0




class ProductivitySnapshot(BaseModel):
   day: date
   total_active_seconds: int = Field(default=0, ge=0)
   total_focused_seconds: int = Field(default=0, ge=0)
   total_idle_seconds: int = Field(default=0, ge=0)
   total_clicks: int = Field(default=0, ge=0)
   total_keystrokes: int = Field(default=0, ge=0)
   total_scroll_delta: int = 0
   daily_usage: list[DailyUsageSummary] = Field(default_factory=list)
   hourly_usage: list[HourlyUsage] = Field(default_factory=list)