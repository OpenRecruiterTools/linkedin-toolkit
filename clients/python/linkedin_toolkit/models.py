"""Pydantic models for the contract's shared types.

Every model allows extra fields. That is a deliberate choice, not laziness: the
Chrome extension is authoritative about what a profile contains, it ships on its
own cadence, and a client that rejected an unfamiliar field would break the
moment the extension learned to capture one more thing. Use these to get typed
attribute access and validation of the fields you rely on — not as a gate.

    from linkedin_toolkit import LinkedInToolkit, models

    data = LinkedInToolkit().search_people(keywords="CTO fintech")
    people = [models.Profile.model_validate(p) for p in data["profiles"]]
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "Base",
    "Experience",
    "Education",
    "Profile",
    "Company",
    "Engager",
    "Thread",
    "Message",
    "List",
    "ListMember",
    "Step",
    "Campaign",
    "QueueItem",
    "WriteResult",
    "RateLimit",
    "Status",
    "ResearchRow",
    "ResolvedRow",
    "Pack",
]


class Base(BaseModel):
    """Permissive by design — see the module docstring."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class Experience(Base):
    title: str
    company: str
    start: Optional[str] = None
    end: Optional[str] = None
    description: Optional[str] = None


class Education(Base):
    school: str
    degree: Optional[str] = None
    field: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None


class Profile(Base):
    publicId: str
    url: str
    firstName: str
    lastName: str
    fullName: str
    capturedAt: float
    urn: Optional[str] = None
    headline: Optional[str] = None
    title: Optional[str] = None
    company: Optional[str] = None
    companyUrn: Optional[str] = None
    location: Optional[str] = None
    industry: Optional[str] = None
    photoUrl: Optional[str] = None
    photoDataUrl: Optional[str] = None
    pageText: Optional[str] = None
    skills: Optional[list[str]] = None
    connectionDegree: Optional[int] = None
    experience: Optional[list[Experience]] = None
    education: Optional[list[Education]] = None
    source: Optional[str] = None


class Company(Base):
    universalName: str
    name: str
    url: str
    capturedAt: float
    urn: Optional[str] = None
    industry: Optional[str] = None
    size: Optional[str] = None
    hq: Optional[str] = None
    website: Optional[str] = None
    description: Optional[str] = None
    followerCount: Optional[int] = None


class Engager(Profile):
    reaction: Optional[str] = None
    commentText: Optional[str] = None
    engagedAt: Optional[float] = None


class Thread(Base):
    threadId: str
    participants: list[dict[str, Any]] = Field(default_factory=list)
    lastMessageAt: float
    unread: bool
    snippet: str
    sentiment: Optional[Literal["positive", "neutral", "negative"]] = None


class Message(Base):
    messageId: str
    threadId: str
    fromPublicId: str
    body: str
    sentAt: float


class List(Base):
    """A saved list. Named for the contract's ``List`` type, which shadows the builtin."""

    listId: str
    name: str
    tags: list[str] = Field(default_factory=list)
    createdAt: float
    count: int


class ListMember(Base):
    publicId: str
    profile: Profile
    addedAt: float
    tags: list[str] = Field(default_factory=list)
    contactedBefore: bool = False
    signals: Optional[list[str]] = None


class Step(Base):
    type: str
    note: Optional[str] = None
    body: Optional[str] = None
    subject: Optional[str] = None
    variants: Optional[list[str]] = None
    waitMs: Optional[float] = None
    branch: Optional[dict[str, Any]] = None


class Campaign(Base):
    campaignId: str
    name: str
    steps: list[Step] = Field(default_factory=list)
    status: str
    createdAt: float
    settings: dict[str, Any] = Field(default_factory=dict)
    stats: Optional[dict[str, Any]] = None


class QueueItem(Base):
    id: str
    action: str
    params: dict[str, Any] = Field(default_factory=dict)
    origin: str
    createdAt: float
    status: str
    profile: Optional[Profile] = None
    result: Optional[dict[str, Any]] = None


class WriteResult(Base):
    """``status`` is ``queued`` while Copilot mode is on. That is success."""

    status: Literal["sent", "queued", "dryRun"]
    queueId: Optional[str] = None
    wouldSend: Optional[dict[str, Any]] = None
    sentAt: Optional[float] = None


class RateLimit(Base):
    hourlyUsed: int
    hourlyCap: int
    dailyUsed: int
    dailyCap: int
    nextAllowedAt: float


class Status(Base):
    connected: bool
    extensionVersion: str
    loggedIn: bool
    autopilot: bool
    businessHours: bool
    quotas: dict[str, RateLimit] = Field(default_factory=dict)
    queue: dict[str, Any] = Field(default_factory=dict)
    campaigns: dict[str, Any] = Field(default_factory=dict)
    backoffUntil: Optional[float] = None
    challenge: Optional[dict[str, Any]] = None


class ResearchRow(Base):
    name: Optional[str] = None
    linkedinUrl: Optional[str] = None
    email: Optional[str] = None
    domain: Optional[str] = None
    company: Optional[str] = None


class ResolvedRow(Base):
    row: ResearchRow
    kind: Literal["person", "company", "unresolved"]
    confidence: float
    publicId: Optional[str] = None
    universalName: Optional[str] = None
    candidates: Optional[list[Profile]] = None


class Pack(Base):
    row: ResearchRow
    resolved: ResolvedRow
    signals: list[str] = Field(default_factory=list)
    markdown: str
    csvRow: dict[str, str] = Field(default_factory=dict)
    profile: Optional[Profile] = None
    company: Optional[Company] = None
    recentPosts: Optional[list[dict[str, Any]]] = None
    mutualConnections: Optional[int] = None
    connectionStatus: Optional[str] = None
    enrichment: Optional[dict[str, Any]] = None
